const express = require("express");
const db = require("../db");
const svc = require("../services/scheduleTime.service");
const { generate } = require("../services/schedulerEngine");
const { audit, getStatus, setStatus, requireDraft } = require("./util");

const router = express.Router();

function fetchFullSchedule() {
  const rows = db.prepare(
    `SELECT s.id, s.teacher_id, s.class_id, s.subject_id, s.day_of_week, s.period_number,
            t.name AS teacher_name, c.name AS class_name, c.grade, c.section,
            sub.name AS subject_name, sub.color AS subject_color
     FROM schedule s
     JOIN teachers t ON t.id = s.teacher_id
     JOIN school_classes c ON c.id = s.class_id
     JOIN subjects sub ON sub.id = s.subject_id
     ORDER BY s.day_of_week, s.period_number, c.name`
  ).all();
  const cache = {};
  const dayPeriods = (d, n) => (cache[`${d}`] = cache[`${d}`] || svc.computeDayPeriods(d, 12));
  return rows.map((r) => {
    const p = dayPeriods(r.day_of_week).find((x) => x.period === r.period_number);
    return { ...r, start_time: p ? p.start : null, end_time: p ? p.end : null };
  });
}

// فحص قبل الحفظ: أيام الدوام، عدد الحصص، تعارض المعلم، تعارض الصف
function checkSlot({ teacher_id, class_id, day, period, excludeIds = [] }) {
  const cls = db.prepare("SELECT * FROM school_classes WHERE id=?").get(class_id);
  if (!cls) return "الصف غير موجود";
  if (!svc.getWorkingDays().includes(day)) return "هذا اليوم ليس يوم دوام";
  const max = svc.getPeriodsPerDayForClass(cls, day);
  if (!(period >= 1 && period <= max)) return `رقم الحصة خارج المسموح لهذا الصف في هذا اليوم (1–${max})`;
  const ex = excludeIds.length ? `AND id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
  const t = db.prepare(`SELECT 1 FROM schedule WHERE teacher_id=? AND day_of_week=? AND period_number=? ${ex}`).get(teacher_id, day, period, ...excludeIds);
  if (t) return "هذا المعلم عنده حصة أخرى بنفس التوقيت";
  const c = db.prepare(`SELECT 1 FROM schedule WHERE class_id=? AND day_of_week=? AND period_number=? ${ex}`).get(class_id, day, period, ...excludeIds);
  if (c) return "هذا الصف عنده مادة أخرى مجدولة بنفس التوقيت";
  return null;
}

function buildValidationReport() {
  const reqs = db.prepare(
    `SELECT cs.*, c.name AS class_name, sub.name AS subject_name FROM class_subjects cs
     JOIN school_classes c ON c.id=cs.class_id JOIN subjects sub ON sub.id=cs.subject_id WHERE cs.weekly_periods > 0`
  ).all();
  const sched = db.prepare("SELECT * FROM schedule").all();
  const cnt = {}, perDay = {};
  sched.forEach((s) => {
    const k = `${s.class_id}-${s.subject_id}`;
    cnt[k] = (cnt[k] || 0) + 1;
    perDay[`${k}-${s.day_of_week}`] = (perDay[`${k}-${s.day_of_week}`] || 0) + 1;
  });
  const assigned = new Set(db.prepare("SELECT class_id, subject_id FROM teacher_assignments").all().map((r) => `${r.class_id}-${r.subject_id}`));
  const issues = [];
  let totalRequired = 0, totalFilled = 0;
  reqs.forEach((r) => {
    const k = `${r.class_id}-${r.subject_id}`;
    const have = cnt[k] || 0;
    totalRequired += r.weekly_periods;
    totalFilled += Math.min(have, r.weekly_periods);
    const label = `${r.subject_name} — ${r.class_name}`;
    if (!assigned.has(k)) issues.push({ level: "error", message: `${label}: لا يوجد معلم مرتبط بهذه المادة في هذا الصف` });
    if (have < r.weekly_periods) issues.push({ level: "error", message: `${label}: ناقص ${r.weekly_periods - have} حصة (${have} من ${r.weekly_periods})` });
    if (have > r.weekly_periods) issues.push({ level: "warn", message: `${label}: زائد ${have - r.weekly_periods} حصة عن المطلوب` });
    const cap = r.allow_same_day_repeat ? r.max_per_day : 1;
    for (let d = 0; d < 7; d++) {
      if ((perDay[`${k}-${d}`] || 0) > cap) issues.push({ level: "warn", message: `${label}: تكرار أكثر من المسموح (${cap}) في يوم واحد` });
    }
  });
  // حصص خارج أيام الدوام/عدد الحصص
  const working = new Set(svc.getWorkingDays());
  const classes = Object.fromEntries(db.prepare("SELECT * FROM school_classes").all().map((c) => [c.id, c]));
  sched.forEach((s) => {
    if (!working.has(s.day_of_week)) issues.push({ level: "error", message: `حصة خارج أيام الدوام (id ${s.id})` });
    else if (s.period_number > svc.getPeriodsPerDayForClass(classes[s.class_id], s.day_of_week))
      issues.push({ level: "error", message: `حصة خارج عدد الحصص اليومي (id ${s.id})` });
  });
  const missing = totalRequired - totalFilled;
  return {
    status: getStatus(),
    completionPercent: totalRequired ? Math.round((totalFilled / totalRequired) * 100) : 0,
    totalRequired, totalFilled, missing, totalScheduled: sched.length,
    conflicts: 0, // يمنعها القيد الفريد في قاعدة البيانات
    issues,
  };
}

router.get("/", (req, res) => res.json(fetchFullSchedule()));
router.get("/status", (req, res) => res.json({ status: getStatus() }));
router.get("/validate", (req, res) => res.json(buildValidationReport()));

router.post("/approve", (req, res) => {
  setStatus("approved"); audit("schedule_approved"); res.json({ status: "approved" });
});
router.post("/unapprove", (req, res) => {
  setStatus("draft"); audit("schedule_unlocked"); res.json({ status: "draft" });
});

const joined = (id) => db.prepare(
  `SELECT s.*, t.name AS teacher_name, c.name AS class_name, sub.name AS subject_name, sub.color AS subject_color
   FROM schedule s JOIN teachers t ON t.id=s.teacher_id JOIN school_classes c ON c.id=s.class_id JOIN subjects sub ON sub.id=s.subject_id WHERE s.id=?`).get(id);

// إضافة حصة يدوياً — بدون أي شرط تخصص
router.post("/", requireDraft, (req, res) => {
  const { teacher_id, class_id, subject_id } = req.body;
  const day = Number(req.body.day_of_week), period = Number(req.body.period_number);
  if (!teacher_id || !class_id || !subject_id || Number.isNaN(day) || !period)
    return res.status(400).json({ error: "كل الحقول مطلوبة (المعلم، الصف، المادة، اليوم، رقم الحصة)" });
  const err = checkSlot({ teacher_id, class_id, day, period });
  if (err) return res.status(409).json({ error: err });
  const r = db.prepare("INSERT INTO schedule (teacher_id, class_id, subject_id, day_of_week, period_number) VALUES (?,?,?,?,?)")
    .run(teacher_id, class_id, subject_id, day, period);
  audit("schedule_add", { id: r.lastInsertRowid });
  res.status(201).json(joined(r.lastInsertRowid));
});

// تعديل/نقل حصة (تغيير المعلم، المادة، اليوم، رقم الحصة)
router.put("/:id", requireDraft, (req, res) => {
  const cur = db.prepare("SELECT * FROM schedule WHERE id=?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "الحصة غير موجودة" });
  const n = {
    teacher_id: req.body.teacher_id ?? cur.teacher_id,
    subject_id: req.body.subject_id ?? cur.subject_id,
    day_of_week: Number(req.body.day_of_week ?? cur.day_of_week),
    period_number: Number(req.body.period_number ?? cur.period_number),
  };
  const err = checkSlot({ teacher_id: n.teacher_id, class_id: cur.class_id, day: n.day_of_week, period: n.period_number, excludeIds: [cur.id] });
  if (err) return res.status(409).json({ error: err });
  db.prepare("UPDATE schedule SET teacher_id=?, subject_id=?, day_of_week=?, period_number=? WHERE id=?")
    .run(n.teacher_id, n.subject_id, n.day_of_week, n.period_number, cur.id);
  audit("schedule_edit", { id: cur.id, from: cur, to: n });
  res.json(joined(cur.id));
});

// تبديل مكان حصتين
router.post("/swap", requireDraft, (req, res) => {
  const a = db.prepare("SELECT * FROM schedule WHERE id=?").get(req.body.a);
  const b = db.prepare("SELECT * FROM schedule WHERE id=?").get(req.body.b);
  if (!a || !b) return res.status(404).json({ error: "إحدى الحصتين غير موجودة" });
  const ex = [a.id, b.id];
  const e1 = checkSlot({ teacher_id: a.teacher_id, class_id: a.class_id, day: b.day_of_week, period: b.period_number, excludeIds: ex });
  const e2 = checkSlot({ teacher_id: b.teacher_id, class_id: b.class_id, day: a.day_of_week, period: a.period_number, excludeIds: ex });
  if (e1 || e2) return res.status(409).json({ error: e1 || e2 });
  db.transaction(() => {
    const up = db.prepare("UPDATE schedule SET day_of_week=?, period_number=? WHERE id=?");
    up.run(a.day_of_week, -a.id, a.id); // موضع مؤقت لتفادي القيد الفريد
    up.run(a.day_of_week, a.period_number, b.id); // b إلى مكان a
    up.run(b.day_of_week, b.period_number, a.id); // a إلى مكان b
  })();
  audit("schedule_swap", { a: a.id, b: b.id });
  res.json({ ok: true });
});

router.delete("/:id", requireDraft, (req, res) => {
  db.prepare("DELETE FROM schedule WHERE id=?").run(req.params.id);
  audit("schedule_delete", { id: req.params.id });
  res.json({ ok: true });
});

router.delete("/", requireDraft, (req, res) => {
  db.prepare("DELETE FROM schedule").run();
  audit("schedule_clear");
  res.json({ ok: true });
});

// ---------- التوليد الذكي ----------
router.post("/auto-generate", requireDraft, (req, res) => {
  const days = svc.getWorkingDays();
  const classes = db.prepare("SELECT * FROM school_classes ORDER BY id").all();
  if (!classes.length) return res.status(400).json({ error: "ضيف الصفوف أولاً (من صفحة الصفوف والشعب)" });
  if (!days.length) return res.status(400).json({ error: "حدد أيام الدوام أولاً" });
  const reqRows = db.prepare("SELECT * FROM class_subjects WHERE weekly_periods > 0").all();
  if (!reqRows.length) return res.status(400).json({ error: "حدد مواد الصفوف وعدد حصصها الأسبوعي من صفحة «توزيع المواد»" });

  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  const assign = {};
  db.prepare("SELECT * FROM teacher_assignments").all().forEach((a) => {
    (assign[`${a.class_id}-${a.subject_id}`] = assign[`${a.class_id}-${a.subject_id}`] || []).push(a.teacher_id);
  });

  const result = generate({
    classes, days,
    periodsFor: (cid, d) => svc.getPeriodsPerDayForClass(byId[cid], d),
    requirements: reqRows.map((r) => ({ class_id: r.class_id, subject_id: r.subject_id, weekly: r.weekly_periods,
      allowRepeat: !!r.allow_same_day_repeat, maxPerDay: r.max_per_day })),
    teachersFor: (cid, sid) => assign[`${cid}-${sid}`] || [],
  });

  db.transaction(() => {
    db.prepare("DELETE FROM schedule").run();
    const ins = db.prepare("INSERT INTO schedule (teacher_id, class_id, subject_id, day_of_week, period_number) VALUES (?,?,?,?,?)");
    result.placements.forEach((p) => ins.run(p.teacher_id, p.class_id, p.subject_id, p.day_of_week, p.period_number));
  })();
  audit("schedule_generated", { filled: result.filled, required: result.required, score: result.score });

  res.json({ filled: result.filled, required: result.required, unfilled: result.required - result.filled,
    score: result.score, softViolations: result.softViolations, report: buildValidationReport() });
});

module.exports = router;
module.exports.fetchFullSchedule = fetchFullSchedule;
module.exports.buildValidationReport = buildValidationReport;
