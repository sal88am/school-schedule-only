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
  const overrides = db.prepare(
    `SELECT o.*, c.name AS class_name FROM period_overrides o LEFT JOIN school_classes c ON c.id=o.class_id WHERE o.school_id = ? ORDER BY o.day_of_week, o.class_id`).all(sid);
  return { shifts, dayConfig, preview, overrides };
}

router.get("/", (req, res) => res.json(snapshot(req.schoolId)));

// أوقات حصص كل يوم دوام (للواجهة)
router.get("/day-periods", (req, res) => {
  const out = {};
  svc.getWorkingDays(req.schoolId).forEach((d) => (out[d] = svc.computeDayPeriods(req.schoolId, d)));
  res.json(out);
});

// عدد الدروس لكل يوم: class_id فارغ = لكل الصفوف، أو لصف واحد. period_count فارغ = إلغاء التخصيص.
router.put("/day-periods", (req, res) => {
  const sid = req.schoolId, b = req.body;
  const day = Number(b.day_of_week), classId = b.class_id ? Number(b.class_id) : null;
  if (!svc.getWorkingDays(sid).includes(day)) return res.status(400).json({ error: "اليوم المختار ليس يوم دوام" });
  if (classId && !db.prepare("SELECT 1 FROM school_classes WHERE id=? AND school_id=?").get(classId, sid)) return res.status(404).json({ error: "الصف غير موجود" });
  const key = [sid, day, classId || 0];
  const existing = db.prepare("SELECT id FROM period_overrides WHERE school_id=? AND day_of_week=? AND ifnull(class_id,0)=?").get(...key);
  if (b.period_count === null || b.period_count === "" || b.period_count === undefined) {
    if (existing) db.prepare("DELETE FROM period_overrides WHERE id=?").run(existing.id);
  } else {
    const n = Number(b.period_count);
    if (!(n >= 1 && n <= 12)) return res.status(400).json({ error: "عدد الدروس بين 1 و 12" });
    if (existing) db.prepare("UPDATE period_overrides SET period_count=? WHERE id=?").run(n, existing.id);
    else db.prepare("INSERT INTO period_overrides (school_id, day_of_week, class_id, period_count) VALUES (?,?,?,?)").run(sid, day, classId, n);
  }
  // حصص موجودة خارج العدد الجديد؟ (تنبيه — لا حذف تلقائي)
  const resolve = svc.periodsResolver(sid);
  const classes = Object.fromEntries(db.prepare("SELECT * FROM school_classes WHERE school_id=?").all(sid).map((c) => [c.id, c]));
  const outside = db.prepare("SELECT class_id, period_number FROM schedule WHERE school_id=? AND day_of_week=?").all(sid, day)
    .filter((r) => classes[r.class_id] && r.period_number > resolve(classes[r.class_id], day)).length;
  audit(sid, "day_periods_updated", { day, classId, count: b.period_count });
  res.json({ ...snapshot(sid), outside });
});

// عدد دروس كل صف بكل يوم (للجداول)
router.get("/class-periods", (req, res) => res.json(svc.classPeriodsMap(req.schoolId)));

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
  // استراحة مخصّصة بعد كل درس (اختياري): مصفوفة أرقام 0..60
  let breaks = shift.breaks;
  if (b.breaks !== undefined) {
    if (b.breaks === null) breaks = null;
    else {
      if (!Array.isArray(b.breaks) || b.breaks.length > 11 || b.breaks.some((x) => !Number.isInteger(Number(x)) || Number(x) < 0 || Number(x) > 60))
        return res.status(400).json({ error: "مدة كل استراحة بين 0 و 60 دقيقة" });
      breaks = JSON.stringify(b.breaks.map(Number));
    }
  }
  db.prepare("UPDATE school_shifts SET start_time = ?, period_count = ?, period_minutes = ?, break_minutes = ?, breaks = ? WHERE school_id = ? AND shift_type = ?")
    .run(start, count, mins, brk, breaks, sid, shift.shift_type);
  audit(sid, "shift_updated", { type: shift.shift_type, start, count, mins, brk, breaks });
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
