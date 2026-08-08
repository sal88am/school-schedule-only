require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

require("./db"); // يضمن إنشاء قاعدة البيانات والجداول عند الإقلاع

const teachersRouter = require("./routes/teachers");
const { buildSimpleRouter } = require("./routes/lookups");
const classesRouter = require("./routes/classes");
const periodTimesRouter = require("./routes/periodTimes");
const settingsRouter = require("./routes/settings");
const scheduleRouter = require("./routes/schedule");
const publicRouter = require("./routes/publicSchedule");

const app = express();
app.use(cors());
app.use(express.json());

// مسارات عامة للمشاركة والطباعة — بدون كلمة مرور، قراءة فقط
app.use("/api/public", publicRouter);

// حماية بسيطة للوحة التحكم عبر كلمة مرور مشتركة (Header: x-admin-password)
app.use("/api", (req, res, next) => {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return next(); // ما مفعّلة الحماية إذا ما محدد كلمة مرور
  const provided = req.header("x-admin-password");
  if (provided === required) return next();
  return res.status(401).json({ error: "غير مصرح — تحقق من كلمة المرور" });
});

app.use("/api/teachers", teachersRouter);
app.use("/api/subjects", buildSimpleRouter("subjects"));
app.use("/api/classes", classesRouter);
app.use("/api/period-times", periodTimesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/schedule", scheduleRouter);

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
});
