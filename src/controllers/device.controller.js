const crypto = require("crypto");
const { db } = require("../config/firebase");

function tokenDocId(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function registerDevice(req, res, next) {
  try {
    const { fcmToken, platform } = req.body;
    if (typeof fcmToken !== "string" || fcmToken.length < 20 || fcmToken.length > 4096) {
      return res.status(400).json({ error: "A valid fcmToken is required." });
    }
    if (!["android", "ios"].includes(platform)) {
      return res.status(400).json({ error: "platform must be android or ios." });
    }

    const id = tokenDocId(fcmToken);
    await db.collection("devices").doc(id).set({
      uid: req.user.uid,
      fcmToken,
      platform,
      active: true,
      updatedAt: new Date()
    }, { merge: true });

    res.status(200).json({ message: "Device token registered." });
  } catch (error) { next(error); }
}

async function unregisterDevice(req, res, next) {
  try {
    const { fcmToken } = req.body;
    if (typeof fcmToken !== "string") {
      return res.status(400).json({ error: "fcmToken is required." });
    }
    const id = tokenDocId(fcmToken);
    const ref = db.collection("devices").doc(id);
    const doc = await ref.get();
    if (doc.exists && doc.get("uid") === req.user.uid) {
      await ref.update({ active: false, updatedAt: new Date() });
    }
    res.status(200).json({ message: "Device token unregistered." });
  } catch (error) { next(error); }
}

module.exports = { registerDevice, unregisterDevice };
