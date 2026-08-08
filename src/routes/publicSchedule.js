const express = require("express");
const db = require("../db");
const { fetchFullSchedule } = require("./schedule");

// مسارات عامة بدون كلمة مرور — للمشاركة والطباعة فقط (قراءة لا تعديل)
const router = express.Router();

router.get("/schedule", (req, res) => {
  let rows = fetchFullSchedule();
  if (req.query.class_id) {
    rows = rows.filter((r) => String(r.class_id) === String(req.query.class_id));
  }
  if (req.query.teacher_id) {
    rows = rows.filter((r) => String(r.teacher_id) === String(req.query.teacher_id));
  }
  res.json(rows);
});

router.get("/classes", (req, res) => {
  res.json(db.prepare("SELECT id, name, grade, section FROM school_classes ORDER BY id").all());
});

router.get("/teachers", (req, res) => {
  res.json(db.prepare("SELECT id, name FROM teachers ORDER BY name").all());
});

router.get("/period-times", (req, res) => {
  res.json(db.prepare("SELECT * FROM period_times ORDER BY period_number").all());
});

router.get("/working-days", (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'working_days'").get();
  res.json({ working_days: row ? JSON.parse(row.value) : [0, 1, 2, 3, 4] });
});

router.get("/school-info", (req, res) => {
  const name = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
  const logo = db.prepare("SELECT value FROM settings WHERE key = 'school_logo'").get();
  res.json({
    school_name: name ? name.value : "",
    school_logo: logo ? logo.value : "",
  });
});

module.exports = router;
