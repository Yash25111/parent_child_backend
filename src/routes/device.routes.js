const router = require("express").Router();
const { registerDevice, unregisterDevice } = require("../controllers/device.controller");

router.post("/token", registerDevice);
router.delete("/token", unregisterDevice);

module.exports = router;
