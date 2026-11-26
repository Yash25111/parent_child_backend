const { admin, db } = require("../config/firebase");

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: "Missing Bearer Firebase ID token." });
    }

    // checkRevoked=true rejects tokens for disabled/revoked Firebase accounts.
    const decoded = await admin.auth().verifyIdToken(match[1], true);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired authentication token." });
  }
}

function requireRole(expectedRole) {
  return async (req, res, next) => {
    try {
      const userDoc = await db.collection("users").doc(req.user.uid).get();
      if (!userDoc.exists) {
        return res.status(403).json({
          error: "Account role has not been selected. Please complete role selection."
        });
      }
      const role = userDoc.get("role");
      if (role !== expectedRole) {
        return res.status(403).json({
          error: `This action requires a ${expectedRole} account.`
        });
      }
      req.user.role = role;
      req.user.displayName = userDoc.get("displayName") || req.user.name || null;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { requireAuth, requireRole };
