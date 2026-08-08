const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/working-days", (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'working_days'").get();
  res.json({ working_days: row ? JSON.parse(row.value) : [0, 1, 2, 3, 4] });
});

router.put("/working-days", (req, res) => {
  const { working_days } = req.body;
  if (!Array.isArray(working_days) || working_days.length === 0) {
    return res.status(400).json({ error: "لازم تختار يوم دوام واحد على الأقل" });
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('working_days', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(JSON.stringify(working_days));
  res.json({ working_days });
});

// اسم المدرسة وشعارها — يظهران بأعلى صفحة مشاركة/طباعة الجدول
router.get("/school-info", (req, res) => {
  const name = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
  const logo = db.prepare("SELECT value FROM settings WHERE key = 'school_logo'").get();
  res.json({
    school_name: name ? name.value : "",
    school_logo: logo ? logo.value : "",
  });
});

router.put("/school-info", (req, res) => {
  const { school_name, school_logo } = req.body;
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  if (school_name !== undefined) upsert.run("school_name", school_name || "");
  if (school_logo !== undefined) upsert.run("school_logo", school_logo || "");
  res.json({ ok: true });
});

module.exports = router;
