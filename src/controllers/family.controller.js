const crypto = require("crypto");
const { db } = require("../config/firebase");

const codeHash = (code) => crypto.createHash("sha256").update(code).digest("hex");
const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (byte) => codeChars[byte % codeChars.length]).join("");
}

async function createPairingCode(req, res, next) {
  try {
    const ttl = Math.max(2, Math.min(30, Number(process.env.PAIRING_CODE_TTL_MINUTES || 10)));
    let code, ref;
    // Retry if the extremely unlikely generated code already exists.
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateCode();
      ref = db.collection("pairingCodes").doc(codeHash(code));
      if (!(await ref.get()).exists) break;
      code = null;
    }
    if (!code) throw new Error("Could not generate a pairing code. Try again.");

    await ref.set({
      parentUid: req.user.uid,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttl * 60 * 1000),
      used: false
    });
    res.status(201).json({ code, expiresInMinutes: ttl });
  } catch (error) { next(error); }
}

async function redeemPairingCode(req, res, next) {
  try {
    const code = String(req.body.code || "").trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
      return res.status(400).json({ error: "Enter the 8-character pairing code." });
    }
    const codeRef = db.collection("pairingCodes").doc(codeHash(code));
    const linkRef = db.collection("familyLinks").doc();

    await db.runTransaction(async (tx) => {
      const codeDoc = await tx.get(codeRef);
      if (!codeDoc.exists) {
        const error = new Error("Pairing code is invalid or expired.");
        error.status = 400;
        throw error;
      }
      const data = codeDoc.data();
      if (data.used || data.expiresAt.toDate() < new Date()) {
        const error = new Error("Pairing code is invalid, expired or already used.");
        error.status = 400;
        throw error;
      }
      if (data.parentUid === req.user.uid) {
        const error = new Error("Parent and child accounts must be different.");
        error.status = 400;
        throw error;
      }

      const existingLinks = await tx.get(
        db.collection("familyLinks")
          .where("parentUid", "==", data.parentUid)
          .where("childUid", "==", req.user.uid)
          .where("status", "==", "active")
          .limit(1)
      );
      if (!existingLinks.empty) {
        const error = new Error("This account is already linked to that parent.");
        error.status = 409;
        throw error;
      }

      tx.update(codeRef, { used: true, usedAt: new Date(), childUid: req.user.uid });
      tx.set(linkRef, {
        parentUid: data.parentUid,
        childUid: req.user.uid,
        status: "active",
        createdAt: new Date()
      });
    });

    res.status(201).json({ message: "Family devices linked.", linkId: linkRef.id });
  } catch (error) { next(error); }
}

async function listChildren(req, res, next) {
  try {
    const snap = await db.collection("familyLinks")
      .where("parentUid", "==", req.user.uid)
      .where("status", "==", "active")
      .get();

    const children = await Promise.all(snap.docs.map(async (doc) => {
      const childUid = doc.get("childUid");
      const [userDoc, deviceSnap, locDoc] = await Promise.all([
        db.collection("users").doc(childUid).get(),
        db.collection("devices")
          .where("uid", "==", childUid)
          .where("active", "==", true)
          .limit(1)
          .get(),
        db.collection("locations").doc(childUid).get()
      ]);

      const locData = locDoc.exists ? locDoc.data() : null;
      return {
        linkId: doc.id,
        childUid,
        childName: userDoc.exists ? (userDoc.get("displayName") || null) : null,
        childEmail: userDoc.exists ? (userDoc.get("email") || null) : null,
        linkedAt: doc.get("createdAt")?.toDate().toISOString() ?? null,
        hasActiveDevice: !deviceSnap.empty,
        lastLocation: locData ? {
          latitude: locData.latitude,
          longitude: locData.longitude,
          accuracy: locData.accuracy ?? null,
          capturedAt: locData.capturedAt?.toDate().toISOString() ?? null,
          requestId: locData.requestId
        } : null
      };
    }));

    res.json({ children });
  } catch (error) { next(error); }
}

async function listParents(req, res, next) {
  try {
    const snap = await db.collection("familyLinks")
      .where("childUid", "==", req.user.uid)
      .where("status", "==", "active")
      .get();

    const parents = await Promise.all(snap.docs.map(async (doc) => {
      const parentUid = doc.get("parentUid");
      const userDoc = await db.collection("users").doc(parentUid).get();
      return {
        linkId: doc.id,
        parentUid,
        parentName: userDoc.exists ? (userDoc.get("displayName") || null) : null,
        parentEmail: userDoc.exists ? (userDoc.get("email") || null) : null,
        linkedAt: doc.get("createdAt")?.toDate().toISOString() ?? null
      };
    }));

    res.json({ parents });
  } catch (error) { next(error); }
}

async function revokeLink(req, res, next) {
  try {
    const linkId = req.params.linkId;
    const ref = db.collection("familyLinks").doc(linkId);
    const doc = await ref.get();

    if (!doc.exists || doc.get("status") !== "active") {
      return res.status(404).json({ error: "Active family link not found." });
    }

    const parentUid = doc.get("parentUid");
    const childUid = doc.get("childUid");
    if (req.user.uid !== parentUid && req.user.uid !== childUid) {
      return res.status(403).json({ error: "Not authorized to disconnect this link." });
    }

    await ref.update({
      status: "revoked",
      revokedAt: new Date(),
      revokedBy: req.user.uid
    });

    res.status(200).json({ message: "Family link disconnected." });
  } catch (error) { next(error); }
}

module.exports = {
  createPairingCode,
  redeemPairingCode,
  listChildren,
  listParents,
  revokeLink
};
