const router = require("express").Router();
const { requireRole } = require("../middleware/auth");
const {
  createPairingCode,
  redeemPairingCode,
  listChildren,
  listParents,
  revokeLink
} = require("../controllers/family.controller");

router.post("/pairing-codes", requireRole("parent"), createPairingCode);
router.post("/pairing-codes/redeem", requireRole("child"), redeemPairingCode);
router.get("/children", requireRole("parent"), listChildren);
router.get("/parents", requireRole("child"), listParents);
router.delete("/links/:linkId", revokeLink);

module.exports = router;
