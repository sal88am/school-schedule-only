const express = require("express");
const db = require("../db");

const router = express.Router();
const DEFAULT_DAY = -1; // يمثّل "كل أيام الدوام"

// يرجع كل الصفوف: التوقيت الافتراضي (day_of_week = -1) وأي استثناءات ليوم معيّن
router.get("/", (req, res) => {
  res.json(
    db.prepare("SELECT * FROM period_times ORDER BY period_number, day_of_week").all()
  );
});

// إضافة/تعديل توقيت — إذا ما انبعث day_of_week ينحفظ كتوقيت افتراضي لكل الأيام
// إذا انبعث day_of_week (0-6) ينحفظ كاستثناء لهذا اليوم فقط، بدون ما يأثر على باقي الأيام
router.post("/", (req, res) => {
  const { period_number, start_time, end_time } = req.body;
  const num = Number(period_number);
  const day = req.body.day_of_week === undefined || req.body.day_of_week === "" || req.body.day_of_week === "all"
    ? DEFAULT_DAY
    : Number(req.body.day_of_week);

  if (!num || num < 1) {
    return res.status(400).json({ error: "رقم الحصة مطلوب" });
  }

  db.prepare(
    `INSERT INTO period_times (day_of_week, period_number, start_time, end_time) VALUES (?, ?, ?, ?)
     ON CONFLICT(day_of_week, period_number) DO UPDATE SET start_time = excluded.start_time, end_time = excluded.end_time`
  ).run(day, num, start_time || null, end_time || null);

  res.status(201).json(
    db.prepare("SELECT * FROM period_times WHERE day_of_week = ? AND period_number = ?").get(day, num)
  );
});

// حذف توقيت — إما استثناء يوم معيّن (يرجع اليوم يستخدم التوقيت الافتراضي تلقائياً)، أو التوقيت الافتراضي نفسه
router.delete("/:day_of_week/:period_number", (req, res) => {
  db.prepare("DELETE FROM period_times WHERE day_of_week = ? AND period_number = ?").run(
    req.params.day_of_week,
    req.params.period_number
  );
  res.json({ ok: true });
});

module.exports = router;
