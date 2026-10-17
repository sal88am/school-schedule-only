require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

require("./db"); // قاعدة البيانات + الترحيل الآمن
const A = require("./auth");
const { ensureBootstrapUsers } = require("./bootstrap");
ensureBootstrapUsers();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ---- مسارات عامة (بدون تسجيل دخول) ----
app.use("/api/auth", require("./routes/authRoutes"));
const publicRouter = require("./routes/publicSchedule");
app.use("/api/public/:code", publicRouter.resolveSchool, publicRouter);

// ---- كل ما بعده يتطلب تسجيل دخول ----
app.use("/api", A.authenticate);

// المدير العام: إدارة المدارس فقط
app.use("/api/super", A.requireRole("super_admin"), require("./routes/superAdmin"));

// المعلم: جدوله فقط
app.use("/api/me", require("./routes/me"));

// إدارة المدرسة: مدير المدرسة (أو المدير العام بعد اختيار مدرسة). المعلم ممنوع هنا.
const admin = [A.requireRole("school_admin", "super_admin"), A.tenant];
app.use("/api/teachers", ...admin, require("./routes/teachers"));
app.use("/api/subjects", ...admin, require("./routes/subjects"));
app.use("/api/classes", ...admin, require("./routes/classes"));
app.use("/api/class-subjects", ...admin, require("./routes/classSubjects"));
app.use("/api/teacher-assignments", ...admin, require("./routes/teacherAssignments"));
app.use("/api/schedule-config", ...admin, require("./routes/scheduleConfig"));
app.use("/api/settings", ...admin, require("./routes/settings"));
app.use("/api/schedule", ...admin, require("./routes/schedule"));
app.use("/api/audit-logs", ...admin, require("./routes/auditLogs"));
app.use("/api/users", ...admin, require("./routes/users"));

app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/health", (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "خطأ داخلي في الخادم" });
});

module.exports = app;
