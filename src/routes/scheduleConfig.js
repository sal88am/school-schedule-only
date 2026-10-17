const express = require("express");
const db = require("../db");
const svc = require("../services/scheduleTime.service");
const { audit } = require("./util");
const router = express.Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function snapshot(sid) {
  const shifts = svc.getShifts(sid);
  const dayConfig = db.prepare("SELECT * FROM school_day_config WHERE school_id = ? ORDER BY day_of_week").all(sid);
  const preview = {};
  shifts.forEach((s) => (preview[s.shift_type] = svc.buildPeriods(s)));
  return { shifts, dayConfig, preview };
}

router.get("/", (req, res) => res.json(snapshot(req.schoolId)));

// أوقات حصص كل يوم دوام (للواجهة)
router.get("/day-periods", (req, res) => {
  const out = {};
  svc.getWorkingDays(req.schoolId).forEach((d) => (out[d] = svc.computeDayPeriods(req.schoolId, d)));
  res.json(out);
});

router.put("/shift/:type", (req, res) => {
  const sid = req.schoolId;
  const shift = db.prepare("SELECT * FROM school_shifts WHERE school_id = ? AND shift_type = ?").get(sid, req.params.type);
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
  db.prepare("UPDATE school_shifts SET start_time = ?, period_count = ?, period_minutes = ?, break_minutes = ? WHERE school_id = ? AND shift_type = ?")
    .run(start, count, mins, brk, sid, shift.shift_type);
  audit(sid, "shift_updated", { type: shift.shift_type, start, count, mins, brk });
  res.json(snapshot(sid));
});

router.put("/days", (req, res) => {
  const sid = req.schoolId;
  const days = req.body.days;
  if (!days || typeof days !== "object") return res.status(400).json({ error: "بيانات الأيام مطلوبة" });
  const valid = new Set(svc.getShifts(sid).map((s) => s.shift_type));
  const up = db.prepare("INSERT INTO school_day_config (school_id, day_of_week, shift_type) VALUES (?,?,?) ON CONFLICT(school_id, day_of_week) DO UPDATE SET shift_type = excluded.shift_type");
  const entries = Object.entries(days);
  for (const [d, t] of entries) {
    if (!(Number(d) >= 0 && Number(d) <= 6) || (t !== null && !valid.has(t))) return res.status(400).json({ error: "قيمة غير صحيحة" });
  }
  if (!entries.some(([, t]) => t)) return res.status(400).json({ error: "لازم يوم دوام واحد على الأقل" });
  db.transaction(() => entries.forEach(([d, t]) => up.run(sid, Number(d), t)))();
  audit(sid, "days_updated", days);
  res.json(snapshot(sid));
});

module.exports = router;
