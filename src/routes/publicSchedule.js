const express = require("express");
const db = require("../db");
const svc = require("../services/scheduleTime.service");
const { fetchFullSchedule } = require("./schedule");
const { info } = require("./settings");

// مسارات عامة للقراءة فقط (مشاركة/طباعة)
const router = express.Router();

router.get("/schedule", (req, res) => {
  let rows = fetchFullSchedule();
  if (req.query.class_id) rows = rows.filter((r) => String(r.class_id) === String(req.query.class_id));
  if (req.query.teacher_id) rows = rows.filter((r) => String(r.teacher_id) === String(req.query.teacher_id));
  res.json(rows);
});
router.get("/classes", (req, res) => res.json(db.prepare("SELECT id, name, grade, section, custom_periods_per_day FROM school_classes ORDER BY id").all()));
router.get("/teachers", (req, res) => res.json(db.prepare("SELECT id, name FROM teachers ORDER BY name").all()));
router.get("/working-days", (req, res) => {
  const map = svc.getDayShiftMap();
  res.json({ working_days: svc.getWorkingDays(), shifts: Object.fromEntries(Object.entries(map).map(([d, s]) => [d, s ? s.shift_type : null])) });
});
// أوقات الحصص لكل يوم
router.get("/day-periods", (req, res) => {
  const out = {};
  svc.getWorkingDays().forEach((d) => (out[d] = svc.computeDayPeriods(d)));
  res.json(out);
});
router.get("/school-info", (req, res) => res.json(info()));
module.exports = router;
