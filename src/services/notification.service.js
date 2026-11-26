const { messaging, db } = require("../config/firebase");

async function sendLocationRequest(childUid, requestId, meta = {}) {
  const snapshot = await db.collection("devices")
    .where("uid", "==", childUid)
    .where("active", "==", true)
    .get();

  const tokens = snapshot.docs.map((doc) => doc.get("fcmToken")).filter(Boolean);
  if (!tokens.length) {
    const error = new Error("The child's device has not registered an FCM token.");
    error.status = 409;
    throw error;
  }

  const parentUid = String(meta.parentUid || "");
  const parentName = String(meta.parentName || "Parent");

  // Android receives a high-priority data-only message so the Flutter app handles
  // foreground/background prompts cleanly without duplicate system banners.
  // iOS receives an APNs alert + content-available so background/terminated taps work.
  const response = await messaging.sendEachForMulticast({
    tokens,
    data: {
      type: "LOCATION_REQUEST",
      requestId,
      requestedAt: new Date().toISOString(),
      parentUid,
      parentName
    },
    android: { priority: "high" },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert"
      },
      payload: {
        aps: {
          alert: {
            title: "Location Sharing Request",
            body: `${parentName} is requesting your current location.`
          },
          sound: "default",
          "content-available": 1
        }
      }
    }
  });

  const invalidCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered"
  ]);

  const batch = db.batch();
  response.responses.forEach((result, index) => {
    if (!result.success && invalidCodes.has(result.error?.code)) {
      const doc = snapshot.docs[index];
      batch.update(doc.ref, { active: false, updatedAt: new Date() });
    }
  });
  await batch.commit();

  return {
    successCount: response.successCount,
    failureCount: response.failureCount
  };
}

module.exports = { sendLocationRequest };
