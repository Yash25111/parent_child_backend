const crypto = require("crypto");
const { db } = require("../config/firebase");
const {
  sendLocationRequest,
  sendLocationUploadedNotification
} = require("../services/notification.service");

async function hasActiveLink(parentUid, childUid) {
  const snap = await db.collection("familyLinks")
    .where("parentUid", "==", parentUid)
    .where("childUid", "==", childUid)
    .where("status", "==", "active")
    .limit(1)
    .get();
  return !snap.empty;
}

async function requestLocation(req, res, next) {
  try {
    const childUid = req.params.childUid;
    if (!(await hasActiveLink(req.user.uid, childUid))) {
      return res.status(403).json({ error: "No active parent-child link exists." });
    }

    const deviceSnap = await db.collection("devices")
      .where("uid", "==", childUid)
      .where("active", "==", true)
      .limit(1)
      .get();
    if (deviceSnap.empty) {
      return res.status(409).json({
        error: "The child's device has not registered an FCM token."
      });
    }

    // Basic server-side cooldown to prevent notification abuse.
    const cooldown = Math.max(10, Number(process.env.LOCATION_REQUEST_COOLDOWN_SECONDS || 30));
    const cooldownRef = db.collection("locationRequestLimits").doc(`${req.user.uid}_${childUid}`);
    const now = Date.now();
    const requestId = crypto.randomUUID();
    const parentName = req.user.displayName || "Parent";

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(cooldownRef);
      const last = snap.exists ? snap.get("lastRequestedAt").toMillis() : 0;
      if (now - last < cooldown * 1000) {
        const error = new Error(`Please wait ${Math.ceil((cooldown * 1000 - (now - last)) / 1000)} seconds before requesting again.`);
        error.status = 429;
        throw error;
      }
      tx.set(cooldownRef, { lastRequestedAt: new Date(now), parentUid: req.user.uid, childUid });
      tx.set(db.collection("locationRequests").doc(requestId), {
        requestId,
        parentUid: req.user.uid,
        parentName,
        childUid,
        status: "pending",
        createdAt: new Date(now),
        expiresAt: new Date(now + 2 * 60 * 1000)
      });
    });

    const result = await sendLocationRequest(childUid, requestId, {
      parentUid: req.user.uid,
      parentName
    });
    res.status(202).json({
      message: "Location request sent. The child device must respond.",
      requestId,
      fcm: result
    });
  } catch (error) { next(error); }
}

async function getPendingRequests(req, res, next) {
  try {
    const now = new Date();
    const snap = await db.collection("locationRequests")
      .where("childUid", "==", req.user.uid)
      .where("status", "in", ["pending", "approved"])
      .get();

    const requests = snap.docs
      .map((doc) => doc.data())
      .filter((data) => data.expiresAt && data.expiresAt.toDate() > now)
      .sort((a, b) => b.createdAt.toDate() - a.createdAt.toDate())
      .map((data) => ({
        requestId: data.requestId,
        parentUid: data.parentUid,
        parentName: data.parentName || "Parent",
        status: data.status,
        createdAt: data.createdAt?.toDate().toISOString() ?? null,
        expiresAt: data.expiresAt?.toDate().toISOString() ?? null
      }));

    res.json({ requests });
  } catch (error) { next(error); }
}

async function getRequestStatus(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const doc = await db.collection("locationRequests").doc(requestId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Location request not found." });
    }

    const data = doc.data();
    if (data.parentUid !== req.user.uid && data.childUid !== req.user.uid) {
      return res.status(403).json({ error: "Not authorized to view this location request." });
    }

    const now = new Date();
    let effectiveStatus = data.status;
    if ((data.status === "pending" || data.status === "approved") &&
        data.expiresAt && data.expiresAt.toDate() <= now) {
      effectiveStatus = "expired";
    }

    res.json({
      requestId: data.requestId,
      parentUid: data.parentUid,
      parentName: data.parentName || "Parent",
      childUid: data.childUid,
      status: effectiveStatus,
      reason: data.reason || null,
      createdAt: data.createdAt?.toDate().toISOString() ?? null,
      expiresAt: data.expiresAt?.toDate().toISOString() ?? null,
      completedAt: data.completedAt?.toDate().toISOString() ?? null
    });
  } catch (error) { next(error); }
}

async function respondToRequest(req, res, next) {
  try {
    const requestId = req.params.requestId;
    const { action, reason } = req.body;
    if (!["approve", "reject", "permission_denied"].includes(action)) {
      return res.status(400).json({
        error: "action must be 'approve', 'reject', or 'permission_denied'."
      });
    }

    const requestRef = db.collection("locationRequests").doc(requestId);
    const requestDoc = await requestRef.get();
    if (!requestDoc.exists ||
        requestDoc.get("childUid") !== req.user.uid ||
        !["pending", "approved"].includes(requestDoc.get("status")) ||
        requestDoc.get("expiresAt").toDate() <= new Date()) {
      return res.status(403).json({
        error: "This location request is invalid, expired or already completed."
      });
    }

    const statusMap = {
      approve: "approved",
      reject: "rejected",
      permission_denied: "permission_denied"
    };
    const nextStatus = statusMap[action];
    const cleanReason = typeof reason === "string" ? reason.trim().slice(0, 200) : null;

    await requestRef.update({
      status: nextStatus,
      reason: cleanReason,
      respondedAt: new Date()
    });

    res.status(200).json({
      requestId,
      status: nextStatus
    });
  } catch (error) { next(error); }
}

async function uploadLocation(req, res, next) {
  try {
    const { latitude, longitude, accuracy, requestId } = req.body;
    if (![latitude, longitude].every((v) => typeof v === "number" && Number.isFinite(v)) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: "Valid numeric latitude and longitude are required." });
    }
    if (accuracy !== undefined && (typeof accuracy !== "number" || accuracy < 0 || accuracy > 100000)) {
      return res.status(400).json({ error: "accuracy must be a valid non-negative number." });
    }
    if (typeof requestId !== "string" || requestId.length > 100) {
      return res.status(400).json({ error: "requestId is required." });
    }

    const requestRef = db.collection("locationRequests").doc(requestId);
    const requestDoc = await requestRef.get();
    if (!requestDoc.exists ||
        requestDoc.get("childUid") !== req.user.uid ||
        !["pending", "approved"].includes(requestDoc.get("status")) ||
        requestDoc.get("expiresAt").toDate() < new Date()) {
      return res.status(403).json({ error: "This location request is invalid, expired or already completed." });
    }

    const links = await db.collection("familyLinks")
      .where("parentUid", "==", requestDoc.get("parentUid"))
      .where("childUid", "==", req.user.uid)
      .where("status", "==", "active")
      .limit(1)
      .get();
    if (links.empty) {
      return res.status(403).json({ error: "No active family link exists." });
    }

    const capturedAt = new Date();
    const batch = db.batch();
    batch.set(db.collection("locations").doc(req.user.uid), {
      childUid: req.user.uid,
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      requestId,
      capturedAt,
      updatedAt: capturedAt
    });
    batch.update(requestRef, { status: "completed", completedAt: capturedAt });
    await batch.commit();

    // Notify the requesting parent directly via FCM so they can open Google Maps immediately.
    try {
      const childDoc = await db.collection("users").doc(req.user.uid).get();
      const childName = childDoc.exists
        ? (childDoc.get("displayName") || childDoc.get("email") || "Your child")
        : "Your child";
      await sendLocationUploadedNotification({
        parentUid: requestDoc.get("parentUid"),
        childUid: req.user.uid,
        childName,
        requestId,
        latitude,
        longitude,
        accuracy: accuracy ?? null,
        capturedAt
      });
    } catch (notifyErr) {
      console.error("Failed to notify parent after location upload:", notifyErr);
    }

    res.status(200).json({ message: "Location received." });
  } catch (error) { next(error); }
}

async function getLocation(req, res, next) {
  try {
    const childUid = req.params.childUid;
    if (!(await hasActiveLink(req.user.uid, childUid))) {
      return res.status(403).json({ error: "No active parent-child link exists." });
    }
    const doc = await db.collection("locations").doc(childUid).get();
    if (!doc.exists) return res.status(404).json({ error: "No location has been shared yet." });

    const data = doc.data();
    res.json({
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      capturedAt: data.capturedAt?.toDate().toISOString() ?? null,
      requestId: data.requestId
    });
  } catch (error) { next(error); }
}

module.exports = {
  requestLocation,
  getPendingRequests,
  getRequestStatus,
  respondToRequest,
  uploadLocation,
  getLocation
};
