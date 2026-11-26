require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { requireAuth } = require("./middleware/auth");
const { notFound, errorHandler } = require("./middleware/errors");

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin: (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "20kb" }));
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/users", requireAuth, require("./routes/user.routes"));
app.use("/api/devices", requireAuth, require("./routes/device.routes"));
app.use("/api/family", requireAuth, require("./routes/family.routes"));
app.use("/api/location", requireAuth, require("./routes/location.routes"));

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});
