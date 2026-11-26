# Parent–Child Location Backend

Node.js + Express + Firebase Admin SDK backend for **on-demand** location sharing. It does not use Firebase Cloud Functions. It can run on an Oracle Cloud VM or another server.

## What is included

- Firebase ID-token verification on every API route.
- Parent-generated, expiring, single-use pairing codes.
- Child redeems the code from their own signed-in account.
- FCM data-message sent when a linked parent requests a location.
- Child uploads GPS coordinates after handling that request.
- Parent can retrieve the most recently shared location.
- Basic rate limiting and per-family location-request cooldown.
- Device-token registration and invalid-token cleanup.

## Requirements

- Node.js 20+
- A Firebase project with Authentication, Cloud Firestore and Firebase Cloud Messaging enabled.
- A Firebase service account available **only on the backend server**.
- Flutter apps configured with Firebase Auth and FCM.

## Run locally

```bash
npm install
cp .env.example .env
```

Set `FIREBASE_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS` in `.env`. Download a service-account JSON from Firebase Console > Project settings > Service accounts, store it outside this repository, and restrict file permissions:

```bash
chmod 600 /secure/path/firebase-service-account.json
```

Then:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## API

All `/api/*` routes require:

```http
Authorization: Bearer FIREBASE_ID_TOKEN
Content-Type: application/json
```

### 1. Parent creates a pairing code

`POST /api/family/pairing-codes`

Response:

```json
{ "code": "8CHARCOD", "expiresInMinutes": 10 }
```

Show this code to the child. The child must knowingly enter it in their app. Do not pair devices secretly.

### 2. Child redeems the code

`POST /api/family/pairing-codes/redeem`

```json
{ "code": "8CHARCOD" }
```

The child account becomes linked to the parent who generated the code.

### 3. Register an FCM token

Call after sign-in and whenever Firebase Messaging refreshes the token.

`POST /api/devices/token`

```json
{ "fcmToken": "FCM_DEVICE_TOKEN", "platform": "android" }
```

### 4. Parent requests a location

`POST /api/location/request/CHILD_FIREBASE_UID`

The backend verifies the active parent-child link and sends an FCM data message:

```json
{
  "type": "LOCATION_REQUEST",
  "requestId": "server-generated-uuid",
  "requestedAt": "ISO-8601 timestamp"
}
```

Response `202` means the notification was accepted for sending, **not** that GPS was received.

### 5. Child uploads location

`POST /api/location/upload`

```json
{
  "latitude": 28.6139,
  "longitude": 77.2090,
  "accuracy": 18.5,
  "requestId": "the-request-id-from-the-fcm-message"
}
```

The child app should only call this after receiving and handling a valid location request and obtaining the required location permission.

### 6. Parent fetches location

`GET /api/location/CHILD_FIREBASE_UID`

Response:

```json
{
  "latitude": 28.6139,
  "longitude": 77.2090,
  "accuracy": 18.5,
  "capturedAt": "2026-11-26T10:00:00.000Z",
  "requestId": "server-generated-uuid"
}
```

### 7. List linked children (Parent)

`GET /api/family/children`

Returns `{ "children": [{ "linkId", "childUid", "childName", "childEmail", "linkedAt", "hasActiveDevice", "lastLocation" }] }`.

### 8. List linked parents (Child) & Revoke link (Parent or Child)

- `GET /api/family/parents` -> `{ "parents": [{ "linkId", "parentUid", "parentName", "parentEmail", "linkedAt" }] }`
- `DELETE /api/family/links/:linkId` -> revokes an active family link.

### 9. Authoritative User Profile & Role

- `GET /api/users/me` -> `{ "uid", "email", "displayName", "role" }` (`role` is `null` until selected).
- `POST /api/users/role` -> `{ "role": "parent" | "child", "displayName": "..." }` (write-once; returns `409` if already set).
- `DELETE /api/users/me/location-data` -> deletes `locations/{uid}` for privacy/retention compliance.

### 10. Pending Requests, Status Polling & Child Response

- `GET /api/location/requests/pending` (Child) -> active non-expired pending requests.
- `GET /api/location/requests/:requestId` (Parent/Child) -> current request status (`pending`, `approved`, `completed`, `rejected`, `permission_denied`, `expired`).
- `POST /api/location/requests/:requestId/respond` (Child) -> `{ "action": "approve" | "reject" | "permission_denied", "reason"?: "..." }`.

### 11. Unregister a device token

`DELETE /api/devices/token`

```json
{ "fcmToken": "FCM_DEVICE_TOKEN" }
```

## Firestore collections

- `pairingCodes/{sha256(code)}` — hashed pairing code, parent UID, expiry and one-time-use status.
- `familyLinks/{linkId}` — parent UID, child UID and active status.
- `devices/{sha256(fcmToken)}` — UID, FCM token, platform and active status.
- `locations/{childUid}` — latest coordinates and capture timestamp.
- `locationRequests/{requestId}` — pending/completed request, parent/child IDs and expiry; upload is accepted only for a valid pending request.
- `locationRequestLimits/{parentUid_childUid}` — request cooldown.

The backend uses Firebase Admin SDK and bypasses Firestore client security rules. Do not expose service-account credentials to either app. For production, deploy restrictive Firestore rules that deny direct client access to these server-owned collections, and access them through this authenticated API.

## Important Android / iOS behavior

- The Flutter child app must implement an FCM background message handler for `LOCATION_REQUEST`.
- Request location permission transparently, explain the purpose, and provide a visible indication when sharing.
- Android high-priority FCM is not a guarantee of immediate execution. Force-stopped apps, battery restrictions, no network, disabled location services or revoked permissions can prevent a response.
- iOS background execution is more restricted. A silent/data push cannot guarantee that iOS will wake the app and obtain GPS. Do not promise identical on-demand behavior on iOS.
- A successful FCM send is not proof that the child device received the request or uploaded a fresh location. The parent UI should show pending, received, timed out and permission/error states.
- This starter stores the latest location. Add a retention/deletion policy, audit logs, monitoring, request expiry and stronger abuse controls before production.

## Production deployment checklist

1. Put the VM behind HTTPS (Nginx + Let's Encrypt or a managed reverse proxy).
2. Open only SSH and HTTPS publicly; keep the Node API behind the reverse proxy.
3. Run Node under a process manager such as systemd.
4. Store the service-account key securely and rotate it if exposed.
5. Set production CORS origins and secrets.
6. Add Firestore indexes if Firestore reports that a query requires one.
7. Test Android background behavior on real devices and different manufacturers.
8. Complete Google Play location, privacy, consent and child-safety policy requirements.
