const router = require("express").Router();
const { requireRole } = require("../middleware/auth");
const {
  requestLocation,
  getPendingRequests,
  getRequestStatus,
  respondToRequest,
  uploadLocation,
  getLocation
} = require("../controllers/location.controller");

router.post("/request/:childUid", requireRole("parent"), requestLocation);
router.get("/requests/pending", requireRole("child"), getPendingRequests);
router.get("/requests/:requestId", getRequestStatus);
router.post("/requests/:requestId/respond", requireRole("child"), respondToRequest);
router.post("/upload", requireRole("child"), uploadLocation);
router.get("/:childUid", requireRole("parent"), getLocation);

module.exports = router;
