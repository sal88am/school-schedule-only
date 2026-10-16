const express = require("express");
const db = require("../db");
const svc = require("../services/scheduleTime.service");
const { audit } = require("./util");
const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function snapshot() {
  const shifts = svc.getShifts();
  const dayConfig = db.prepare("SELECT * FROM day_shift_config ORDER BY day_of_week").all();
  const preview = {};
  shifts.forEach((s) => (preview[s.shift_type] = svc.buildPeriods(s)));
  return { shifts, dayConfig, preview };
}

router.get("/", (req, res) => res.json(snapshot()));

router.put("/shift/:type", (req, res) => {
  const shift = db.prepare("SELECT * FROM schedule_shifts WHERE shift_type=?").get(req.params.type);
  if (!shift) return res.status(404).json({ error: "الشفت غير موجود" });
  const b = req.body;
  const start = b.start_time ?? shift.start_time;
  const count = Number(b.period_count ?? shift.period_count);
  const mins = Number(b.period_minutes ?? shift.period_minutes);
  const brk = Number(b.break_minutes ?? shift.break_minutes);
  if (!TIME_RE.test(start)) return res.status(400).json({ error: "صيغة وقت البداية غير صحيحة (مثال 08:00)" });
  if (!(count >= 1 && count <= 12)) return res.status(400).json({ error: "عدد الحصص بين 1 و 12" });
  if (!(mins >= 10 && mins <= 120)) return res.status(400).json({ error: "مدة الحصة بين 10 و 120 دقيقة" });
  if (!(brk >= 0 && brk <= 60)) return res.status(400).json({ error: "مدة الاستراحة بين 0 و 60 دقيقة" });
  db.prepare("UPDATE schedule_shifts SET start_time=?, period_count=?, period_minutes=?, break_minutes=? WHERE shift_type=?")
    .run(start, count, mins, brk, shift.shift_type);
  audit("shift_updated", { type: shift.shift_type, start, count, mins, brk });
  res.json(snapshot());
});

// body: { days: { "0":"morning", "3":"evening", "5":null, ... } }
router.put("/days", (req, res) => {
  const days = req.body.days;
  if (!days || typeof days !== "object") return res.status(400).json({ error: "بيانات الأيام مطلوبة" });
  const valid = new Set(svc.getShifts().map((s) => s.shift_type));
  const up = db.prepare("INSERT INTO day_shift_config (day_of_week, shift_type) VALUES (?,?) ON CONFLICT(day_of_week) DO UPDATE SET shift_type=excluded.shift_type");
  const entries = Object.entries(days);
  for (const [d, t] of entries) {
    if (!(Number(d) >= 0 && Number(d) <= 6) || (t !== null && !valid.has(t))) return res.status(400).json({ error: "قيمة غير صحيحة" });
  }
  if (!entries.some(([, t]) => t)) return res.status(400).json({ error: "لازم يوم دوام واحد على الأقل" });
  db.transaction(() => entries.forEach(([d, t]) => up.run(Number(d), t)))();
  audit("days_updated", days);
  res.json(snapshot());
});

module.exports = router;
