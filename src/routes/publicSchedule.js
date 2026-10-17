const express = require("express");
const db = require("../db");
const svc = require("../services/scheduleTime.service");
const { fetchFullSchedule } = require("./schedule");
const { info } = require("./settings");

// مسارات عامة للقراءة فقط عبر رمز مشاركة المدرسة (share_code) — لا تُرجع إلا بيانات تلك المدرسة
const router = express.Router();

function resolveSchool(req, res, next) {
  const s = db.prepare("SELECT id, is_active, subscription_status FROM schools WHERE share_code = ?").get(String(req.params.code || ""));
  if (!s || !s.is_active || ["suspended", "expired"].includes(s.subscription_status)) return res.status(404).json({ error: "الرابط غير صالح" });
  req.schoolId = s.id;
  next();
}

router.get("/schedule", (req, res) => {
  let rows = fetchFullSchedule(req.schoolId);
  if (req.query.class_id) rows = rows.filter((r) => String(r.class_id) === String(req.query.class_id));
  if (req.query.teacher_id) rows = rows.filter((r) => String(r.teacher_id) === String(req.query.teacher_id));
  // بيانات غير حساسة فقط (بدون هواتف أو حسابات)
  res.json(rows);
});
router.get("/classes", (req, res) => res.json(db.prepare("SELECT id, name, grade, section, custom_periods_per_day FROM school_classes WHERE school_id = ? ORDER BY id").all(req.schoolId)));
router.get("/teachers", (req, res) => res.json(db.prepare("SELECT id, name FROM teachers WHERE school_id = ? ORDER BY name").all(req.schoolId)));
router.get("/working-days", (req, res) => {
  const map = svc.getDayShiftMap(req.schoolId);
  res.json({ working_days: svc.getWorkingDays(req.schoolId), shifts: Object.fromEntries(Object.entries(map).map(([d, s]) => [d, s ? s.shift_type : null])) });
});
router.get("/day-periods", (req, res) => {
  const out = {};
  svc.getWorkingDays(req.schoolId).forEach((d) => (out[d] = svc.computeDayPeriods(req.schoolId, d)));
  res.json(out);
});
router.get("/school-info", (req, res) => res.json(info(req.schoolId)));

module.exports = router;
module.exports.resolveSchool = resolveSchool;
