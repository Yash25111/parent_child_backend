const { db } = require("../config/firebase");

async function getCurrentUser(req, res, next) {
  try {
    const ref = db.collection("users").doc(req.user.uid);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(200).json({
        uid: req.user.uid,
        email: req.user.email,
        displayName: req.user.name,
        role: null
      });
    }

    const data = doc.data();
    return res.status(200).json({
      uid: req.user.uid,
      email: data.email || req.user.email,
      displayName: data.displayName || req.user.name,
      role: data.role || null,
      createdAt: data.createdAt?.toDate().toISOString() ?? null
    });
  } catch (error) {
    next(error);
  }
}

async function setUserRole(req, res, next) {
  try {
    const { role, displayName } = req.body;
    if (!["parent", "child"].includes(role)) {
      return res.status(400).json({ error: "role must be 'parent' or 'child'." });
    }

    const cleanName = typeof displayName === "string" && displayName.trim().length > 0
      ? displayName.trim().slice(0, 100)
      : (req.user.name || null);

    const ref = db.collection("users").doc(req.user.uid);

    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (doc.exists && doc.get("role")) {
        const error = new Error("Role is already assigned and cannot be changed.");
        error.status = 409;
        throw error;
      }

      tx.set(ref, {
        uid: req.user.uid,
        email: req.user.email,
        displayName: cleanName,
        role,
        createdAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });
    });

    return res.status(200).json({
      uid: req.user.uid,
      email: req.user.email,
      displayName: cleanName,
      role
    });
  } catch (error) {
    next(error);
  }
}

async function deleteMyLocationData(req, res, next) {
  try {
    await db.collection("locations").doc(req.user.uid).delete();
    return res.status(200).json({ message: "Stored location data deleted." });
  } catch (error) {
    next(error);
  }
}

module.exports = { getCurrentUser, setUserRole, deleteMyLocationData };
