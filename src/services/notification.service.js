const { messaging, db } = require("../config/firebase");

async function cleanInvalidTokens(snapshot, response) {
  const invalidCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered"
  ]);

  const batch = db.batch();
  let hasUpdates = false;
  response.responses.forEach((result, index) => {
    if (!result.success && invalidCodes.has(result.error?.code)) {
      const doc = snapshot.docs[index];
      batch.update(doc.ref, { active: false, updatedAt: new Date() });
      hasUpdates = true;
    }
  });
  if (hasUpdates) {
    await batch.commit();
  }
}

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

  // Android receives a high-priority data-only message so the native service
  // handles automatic check-in without requiring the child app to be opened.
  // iOS receives an APNs alert + content-available for notification-tap flow.
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

  await cleanInvalidTokens(snapshot, response);

  return {
    successCount: response.successCount,
    failureCount: response.failureCount
  };
}

async function sendLocationUploadedNotification({
  parentUid,
  childUid,
  childName,
  requestId,
  latitude,
  longitude,
  accuracy,
  capturedAt
}) {
  const snapshot = await db.collection("devices")
    .where("uid", "==", parentUid)
    .where("active", "==", true)
    .get();

  const tokens = snapshot.docs.map((doc) => doc.get("fcmToken")).filter(Boolean);
  if (!tokens.length) {
    return { successCount: 0, failureCount: 0 };
  }

  const label = childName || "Your child";
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: `${label} shared their location`,
      body: "Tap to open directly in Google Maps."
    },
    data: {
      type: "LOCATION_SHARED",
      requestId: String(requestId),
      childUid: String(childUid),
      childName: String(label),
      latitude: String(latitude),
      longitude: String(longitude),
      accuracy: accuracy != null ? String(accuracy) : "",
      capturedAt: capturedAt instanceof Date
        ? capturedAt.toISOString()
        : String(capturedAt || new Date().toISOString())
    },
    android: {
      priority: "high",
      notification: {
        channelId: "family_connect_location_requests"
      }
    },
    apns: {
      headers: {
        "apns-priority": "10",
        "apns-push-type": "alert"
      },
      payload: {
        aps: {
          sound: "default",
          "content-available": 1
        }
      }
    }
  });

  await cleanInvalidTokens(snapshot, response);

  return {
    successCount: response.successCount,
    failureCount: response.failureCount
  };
}

module.exports = { sendLocationRequest, sendLocationUploadedNotification };
