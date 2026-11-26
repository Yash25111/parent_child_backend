const router = require("express").Router();
const { getCurrentUser, setUserRole, deleteMyLocationData } = require("../controllers/user.controller");

router.get("/me", getCurrentUser);
router.post("/role", setUserRole);
router.delete("/me/location-data", deleteMyLocationData);

module.exports = router;
