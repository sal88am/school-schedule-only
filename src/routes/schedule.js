const express = require("express");
const db = require("../db");
const svc = require("../services/scheduleTime.service");
const { generate } = require("../services/schedulerEngine");
const { expandRules } = require("../services/fixedRules.service");
const { audit, getStatus, setStatus, requireDraft, owned } = require("./util");

const router = express.Router();
const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const ORD = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
const slotLabel = (d, p) => `${DAY_NAMES[d]} — الدرس ${ORD[p - 1] || p}`;

function fetchFullSchedule(sid) {
  const rows = db.prepare(
    `SELECT s.id, s.teacher_id, s.class_id, s.subject_id, s.day_of_week, s.period_number, s.lock_kind,
            t.name AS teacher_name, c.name AS class_name, c.grade, c.section,
            sub.name AS subject_name, sub.color AS subject_color
     FROM schedule s
     JOIN teachers t ON t.id = s.teacher_id
     JOIN school_classes c ON c.id = s.class_id
     JOIN subjects sub ON sub.id = s.subject_id
     WHERE s.school_id = ?
     ORDER BY s.day_of_week, s.period_number, c.name`
  ).all(sid);
  const cache = {};
  const dayPeriods = (d) => (cache[d] = cache[d] || svc.computeDayPeriods(sid, d, 12));
  return rows.map((r) => {
    const p = dayPeriods(r.day_of_week).find((x) => x.period === r.period_number);
    return { ...r, start_time: p ? p.start : null, end_time: p ? p.end : null };
  });
}

// ---------- فحص التعارض + اقتراح الحلول ----------
// يعيد { invalid, conflicts[] } — invalid = خطأ بنيوي (يوم عطلة/رقم درس خارج النطاق) بلا حلول
function analyze({ sid, teacher_id, class_id, day, period, excludeIds = [] }) {
  const cls = owned("classes", class_id, sid);
  if (!cls) return { invalid: "الصف غير موجود", conflicts: [] };
  if (!owned("teachers", teacher_id, sid)) return { invalid: "المعلم غير موجود", conflicts: [] };
  if (!svc.getWorkingDays(sid).includes(day)) return { invalid: "هذا اليوم ليس يوم دوام", conflicts: [] };
  const max = svc.getPeriodsPerDayForClass(sid, cls, day);
  if (!(period >= 1 && period <= max)) return { invalid: `رقم الدرس خارج المسموح لهذا الصف في هذا اليوم (1–${max})`, conflicts: [] };
  const ex = excludeIds.length ? `AND s.id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
  const detail = (cond, ...args) => db.prepare(
    `SELECT s.*, t.name AS teacher_name, c.name AS class_name, sub.name AS subject_name
     FROM schedule s JOIN teachers t ON t.id=s.teacher_id JOIN school_classes c ON c.id=s.class_id JOIN subjects sub ON sub.id=s.subject_id
     WHERE ${cond} AND s.day_of_week=? AND s.period_number=? ${ex}`).get(...args, day, period, ...excludeIds);
  const conflicts = [];
  const t = detail("s.teacher_id=?", teacher_id);
  if (t) conflicts.push({ type: "teacher_busy", slot_id: t.id, message: `المعلم «${t.teacher_name}» عنده حصة ${t.subject_name} مع ${t.class_name} بنفس التوقيت (${slotLabel(day, period)})` });
  const c = detail("s.class_id=?", class_id);
  if (c) conflicts.push({ type: "class_busy", slot_id: c.id, message: `الصف «${c.class_name}» عنده ${c.subject_name} (${c.teacher_name}) بنفس التوقيت (${slotLabel(day, period)})` });
  return { invalid: null, conflicts };
}

// خانات فارغة لصف ومعلم معاً (مع استثناء حصص معيّنة من الإشغال)، مرتّبة بالأفضلية
function freeSlotsFor(sid, cls, teacher_id, exIds, subject_id, refDay, refPeriod, forbid = []) {
  const resolve = svc.periodsResolver(sid);
  const classRows = db.prepare("SELECT * FROM schedule WHERE class_id=? AND school_id=?").all(cls.id, sid).filter((r) => !exIds.includes(r.id));
  const teacherRows = db.prepare("SELECT * FROM schedule WHERE teacher_id=? AND school_id=?").all(teacher_id, sid).filter((r) => !exIds.includes(r.id));
  const cBusy = new Set(classRows.map((r) => `${r.day_of_week}-${r.period_number}`));
  const tBusy = new Set(teacherRows.map((r) => `${r.day_of_week}-${r.period_number}`));
  const sameSubj = (d) => classRows.filter((r) => r.subject_id === subject_id && r.day_of_week === d).length;
  const out = [];
  svc.getWorkingDays(sid).forEach((d) => {
    const n = resolve(cls, d);
    for (let p = 1; p <= n; p++) {
      const k = `${d}-${p}`;
      if ((d === refDay && p === refPeriod) || cBusy.has(k) || tBusy.has(k) || forbid.includes(k)) continue;
      const cat = d === refDay ? "sameDay" : p === refPeriod ? "sameLesson" : "other";
      out.push({ d, p, cat, dup: sameSubj(d), rank: (d === refDay ? 0 : 10) + Math.abs(p - refPeriod) + sameSubj(d) * 6 });
    }
  });
  return out.sort((a, b) => a.rank - b.rank);
}

// حلول مقترحة: أماكن بديلة فارغة، معلم بديل، أو تبديل مع الحصة المشغولة
function suggest({ sid, teacher_id, class_id, subject_id, day, period, cur, conflicts }) {
  const out = [];
  const cls = owned("classes", class_id, sid);
  if (!cls) return out;
  const exIds = cur ? [cur.id] : [];
  const resolve = svc.periodsResolver(sid);
  const classRows = db.prepare("SELECT * FROM schedule WHERE class_id=? AND school_id=?").all(class_id, sid).filter((r) => !exIds.includes(r.id));
  const teacherRows = db.prepare("SELECT * FROM schedule WHERE teacher_id=? AND school_id=?").all(teacher_id, sid).filter((r) => !exIds.includes(r.id));
  const cBusy = new Set(classRows.map((r) => `${r.day_of_week}-${r.period_number}`));
  const tBusy = new Set(teacherRows.map((r) => `${r.day_of_week}-${r.period_number}`));
  const sameSubjDay = (d) => classRows.filter((r) => r.subject_id === subject_id && r.day_of_week === d).length;
  const apiMove = (d, p) => cur
    ? { method: "PUT", url: `/api/schedule/${cur.id}`, body: { day_of_week: d, period_number: p, teacher_id, subject_id } }
    : { method: "POST", url: "/api/schedule", body: { teacher_id, class_id, subject_id, day_of_week: d, period_number: p } };

  // 1) أماكن فارغة: درس آخر بنفس اليوم / نفس الدرس بيوم آخر / يوم ودرس مختلفان
  const free = freeSlotsFor(sid, cls, teacher_id, exIds, subject_id, day, period);
  const CAT = { sameDay: "درس آخر بنفس اليوم", sameLesson: "يوم آخر بنفس الدرس", other: "يوم ودرس آخر" };
  ["sameDay", "sameLesson", "other"].forEach((cat) => free.filter((f) => f.cat === cat).slice(0, 2).forEach((f) => out.push({
    kind: "move", label: `${cur ? "انقل الحصة" : "ضعها"} إلى ${slotLabel(f.d, f.p)} (${CAT[cat]})${f.dup ? " — المادة موجودة بهذا اليوم" : ""}`, apply: apiMove(f.d, f.p) })));

  // 2) معلم بديل متاح بنفس التوقيت (إذا كان التعارض بسبب المعلم)
  if (conflicts.some((c) => c.type === "teacher_busy") && !conflicts.some((c) => c.type === "class_busy")) {
    const ex = exIds.length ? `AND id NOT IN (${exIds.map(() => "?").join(",")})` : "";
    const busy = new Set(db.prepare(`SELECT teacher_id FROM schedule WHERE school_id=? AND day_of_week=? AND period_number=? ${ex}`).all(sid, day, period, ...exIds).map((r) => r.teacher_id));
    const assigned = new Set(db.prepare("SELECT teacher_id FROM teacher_assignments WHERE school_id=? AND class_id=? AND subject_id=?").all(sid, class_id, subject_id).map((r) => r.teacher_id));
    db.prepare("SELECT id, name FROM teachers WHERE school_id=?").all(sid)
      .filter((t) => t.id !== teacher_id && !busy.has(t.id))
      .sort((a, b) => (assigned.has(b.id) ? 1 : 0) - (assigned.has(a.id) ? 1 : 0))
      .slice(0, 3).forEach((t) => out.push({
        kind: "teacher", label: `غيّر المعلم إلى «${t.name}»${assigned.has(t.id) ? " (مرتبط بالمادة)" : ""} وأبقِ الموعد`,
        apply: cur ? { method: "PUT", url: `/api/schedule/${cur.id}`, body: { teacher_id: t.id, day_of_week: day, period_number: period, subject_id } }
                   : { method: "POST", url: "/api/schedule", body: { teacher_id: t.id, class_id, subject_id, day_of_week: day, period_number: period } } }));
  }

  // 3) تبديل مع الحصة الموجودة بالخانة (عند نقل حصة موجودة إلى خانة مشغولة بنفس الصف)
  const cb = conflicts.find((c) => c.type === "class_busy");
  if (cb && cur && cb.slot_id !== cur.id) {
    const y = db.prepare("SELECT * FROM schedule WHERE id=? AND school_id=?").get(cb.slot_id, sid);
    if (y) {
      const e1 = analyze({ sid, teacher_id: cur.teacher_id, class_id: cur.class_id, day: y.day_of_week, period: y.period_number, excludeIds: [cur.id, y.id] });
      const e2 = analyze({ sid, teacher_id: y.teacher_id, class_id: y.class_id, day: cur.day_of_week, period: cur.period_number, excludeIds: [cur.id, y.id] });
      if (!e1.invalid && !e2.invalid && !e1.conflicts.length && !e2.conflicts.length)
        out.unshift({ kind: "swap", label: `بدّل مكانها مع الحصة الموجودة (${slotLabel(y.day_of_week, y.period_number)} ⇄ ${slotLabel(cur.day_of_week, cur.period_number)})`,
          apply: { method: "POST", url: "/api/schedule/swap", body: { a: cur.id, b: y.id } } });
    }
  }
  // 3ب) سلسلة: حرّك الحصة/الحصص المعطِّلة (صف و/أو معلم) لأماكن فارغة ثم ضع هذه الحصة مكانها
  if (cur && conflicts.length) {
    const blockers = conflicts.map((c) => c.slot_id).filter((id, i, arr) => id && id !== cur.id && arr.indexOf(id) === i);
    const rowsB = blockers.map((id) => db.prepare(
      `SELECT s.*, sub.name AS subject_name, c.name AS class_name FROM schedule s JOIN subjects sub ON sub.id=s.subject_id JOIN school_classes c ON c.id=s.class_id WHERE s.id=? AND s.school_id=?`).get(id, sid));
    if (blockers.length && blockers.length <= 2 && rowsB.every((y) => y && y.lock_kind !== "manual")) {
      for (let variant = 0; variant < 2; variant++) {
        const used = [`${day}-${period}`], steps = [], parts = [];
        let okAll = true;
        for (const y of rowsB) {
          const ycls = owned("classes", y.class_id, sid);
          const cand = ycls && freeSlotsFor(sid, ycls, y.teacher_id, [y.id], y.subject_id, y.day_of_week, y.period_number, used);
          const pick = cand && cand[variant] ? cand[variant] : cand && cand[0];
          if (!pick) { okAll = false; break; }
          used.push(`${pick.d}-${pick.p}`);
          steps.push({ id: y.id, day_of_week: pick.d, period_number: pick.p });
          parts.push(`«${y.subject_name}» (${y.class_name}) إلى ${slotLabel(pick.d, pick.p)}`);
        }
        if (!okAll) break;
        if (variant === 1 && out.some((o) => o.kind === "chain" && JSON.stringify(o.apply.body.steps) === JSON.stringify([...steps, { id: cur.id, day_of_week: day, period_number: period, teacher_id, subject_id }]))) break;
        out.push({
          kind: "chain",
          label: `حرّك ${parts.join(" و")} ثم ضع هذه الحصة في ${slotLabel(day, period)}`,
          apply: { method: "POST", url: "/api/schedule/chain", body: { steps: [...steps, { id: cur.id, day_of_week: day, period_number: period, teacher_id, subject_id }] } } });
      }
    }
  }

  // 4) إضافة جديدة فوق خانة مشغولة: استبدل الحصة الموجودة (تعديلها إلى المادة/المعلم الجديدين)
  if (cb && !cur) {
    const y = db.prepare(
      `SELECT s.*, sub.name AS subject_name FROM schedule s JOIN subjects sub ON sub.id=s.subject_id WHERE s.id=? AND s.school_id=?`).get(cb.slot_id, sid);
    if (y && y.lock_kind !== "manual") {
      const e = analyze({ sid, teacher_id, class_id, day, period, excludeIds: [y.id] });
      if (!e.invalid && !e.conflicts.length)
        out.push({ kind: "replace", label: `استبدل حصة «${y.subject_name}» الموجودة بهذه الحصة (${slotLabel(day, period)})`,
          apply: { method: "PUT", url: `/api/schedule/${y.id}`, body: { subject_id, teacher_id, day_of_week: day, period_number: period } } });
    }
  }
  return out;
}

// خطأ موحّد 409 مع تفاصيل التعارض والحلول
function conflictResponse(res, ctx, an) {
  if (an.invalid) return res.status(409).json({ error: an.invalid, conflicts: [], suggestions: [] });
  return res.status(409).json({
    error: an.conflicts.map((c) => c.message).join(" — "),
    conflicts: an.conflicts,
    suggestions: suggest({ ...ctx, conflicts: an.conflicts }),
  });
}

// تنبيهات غير مانعة بعد الحفظ (زيادة عن المطلوب، تكرار فوق المسموح بنفس اليوم)
function softWarnings(sid, class_id, subject_id, day) {
  const w = [];
  const cs = db.prepare("SELECT cs.*, sub.name AS subject_name FROM class_subjects cs JOIN subjects sub ON sub.id=cs.subject_id WHERE cs.school_id=? AND cs.class_id=? AND cs.subject_id=?").get(sid, class_id, subject_id);
  if (!cs) return w;
  const total = db.prepare("SELECT COUNT(*) n FROM schedule WHERE class_id=? AND subject_id=?").get(class_id, subject_id).n;
  if (cs.weekly_periods && total > cs.weekly_periods) w.push(`تنبيه: ${cs.subject_name} صار ${total} حصة بالأسبوع والمطلوب ${cs.weekly_periods}`);
  const dayN = db.prepare("SELECT COUNT(*) n FROM schedule WHERE class_id=? AND subject_id=? AND day_of_week=?").get(class_id, subject_id, day).n;
  const cap = cs.allow_same_day_repeat ? cs.max_per_day : 1;
  if (dayN > cap) w.push(`تنبيه: ${cs.subject_name} تتكرر ${dayN} مرات بيوم ${DAY_NAMES[day]} والمسموح ${cap}`);
  return w;
}

function buildValidationReport(sid) {
  const reqs = db.prepare(
    `SELECT cs.*, c.name AS class_name, sub.name AS subject_name FROM class_subjects cs
     JOIN school_classes c ON c.id=cs.class_id JOIN subjects sub ON sub.id=cs.subject_id WHERE cs.weekly_periods > 0 AND cs.school_id = ?`
  ).all(sid);
  const sched = db.prepare("SELECT * FROM schedule WHERE school_id = ?").all(sid);
  const cnt = {}, perDay = {};
  sched.forEach((s) => {
    const k = `${s.class_id}-${s.subject_id}`;
    cnt[k] = (cnt[k] || 0) + 1;
    perDay[`${k}-${s.day_of_week}`] = (perDay[`${k}-${s.day_of_week}`] || 0) + 1;
  });
  const assigned = new Set(db.prepare("SELECT class_id, subject_id FROM teacher_assignments WHERE school_id = ?").all(sid).map((r) => `${r.class_id}-${r.subject_id}`));
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
  const working = new Set(svc.getWorkingDays(sid));
  const resolve = svc.periodsResolver(sid);
  const classes = Object.fromEntries(db.prepare("SELECT * FROM school_classes WHERE school_id = ?").all(sid).map((c) => [c.id, c]));
  sched.forEach((s) => {
    if (!working.has(s.day_of_week)) issues.push({ level: "error", message: `حصة خارج أيام الدوام (id ${s.id})` });
    else if (s.period_number > resolve(classes[s.class_id], s.day_of_week))
      issues.push({ level: "error", message: `حصة خارج عدد الحصص اليومي (id ${s.id})` });
  });
  const missing = totalRequired - totalFilled;
  return {
    status: getStatus(sid),
    completionPercent: totalRequired ? Math.round((totalFilled / totalRequired) * 100) : 0,
    totalRequired, totalFilled, missing, totalScheduled: sched.length,
    conflicts: 0, // يمنعها القيد الفريد في قاعدة البيانات
    issues,
  };
}

router.get("/", (req, res) => res.json(fetchFullSchedule(req.schoolId)));
router.get("/status", (req, res) => res.json({ status: getStatus(req.schoolId) }));
router.get("/validate", (req, res) => res.json(buildValidationReport(req.schoolId)));

router.post("/approve", (req, res) => {
  setStatus(req.schoolId, "approved"); audit(req.schoolId, "schedule_approved"); res.json({ status: "approved" });
});
router.post("/unapprove", (req, res) => {
  setStatus(req.schoolId, "draft"); audit(req.schoolId, "schedule_unlocked"); res.json({ status: "draft" });
});

const joined = (id, sid) => db.prepare(
  `SELECT s.*, t.name AS teacher_name, c.name AS class_name, sub.name AS subject_name, sub.color AS subject_color
   FROM schedule s JOIN teachers t ON t.id=s.teacher_id JOIN school_classes c ON c.id=s.class_id JOIN subjects sub ON sub.id=s.subject_id WHERE s.id=? AND s.school_id=?`).get(id, sid);

// إضافة حصة يدوياً — بدون أي شرط تخصص
router.post("/", requireDraft, (req, res) => {
  const { teacher_id, class_id, subject_id } = req.body;
  const day = Number(req.body.day_of_week), period = Number(req.body.period_number);
  if (!teacher_id || !class_id || !subject_id || Number.isNaN(day) || !period)
    return res.status(400).json({ error: "كل الحقول مطلوبة (المعلم، الصف، المادة، اليوم، رقم الدرس)" });
  if (!owned("subjects", subject_id, req.schoolId)) return res.status(404).json({ error: "المادة غير موجودة" });
  const an = analyze({ sid: req.schoolId, teacher_id, class_id, day, period });
  if (an.invalid || an.conflicts.length) return conflictResponse(res, { sid: req.schoolId, teacher_id, class_id, subject_id, day, period, cur: null }, an);
  const r = db.prepare("INSERT INTO schedule (school_id, teacher_id, class_id, subject_id, day_of_week, period_number, lock_kind) VALUES (?,?,?,?,?,?,?)")
    .run(req.schoolId, teacher_id, class_id, subject_id, day, period, req.body.pinned ? "manual" : null);
  audit(req.schoolId, "schedule_add", { id: r.lastInsertRowid });
  res.status(201).json({ ...joined(r.lastInsertRowid, req.schoolId), warnings: softWarnings(req.schoolId, class_id, subject_id, day) });
});

// تعديل/نقل حصة (تغيير المعلم، المادة، اليوم، رقم الدرس، التثبيت)
router.put("/:id", requireDraft, (req, res) => {
  const cur = owned("schedule", req.params.id, req.schoolId);
  if (!cur) return res.status(404).json({ error: "الحصة غير موجودة" });
  const n = {
    teacher_id: req.body.teacher_id ?? cur.teacher_id,
    subject_id: req.body.subject_id ?? cur.subject_id,
    day_of_week: Number(req.body.day_of_week ?? cur.day_of_week),
    period_number: Number(req.body.period_number ?? cur.period_number),
  };
  if (!owned("subjects", n.subject_id, req.schoolId)) return res.status(404).json({ error: "المادة غير موجودة" });
  const an = analyze({ sid: req.schoolId, teacher_id: n.teacher_id, class_id: cur.class_id, day: n.day_of_week, period: n.period_number, excludeIds: [cur.id] });
  if (an.invalid || an.conflicts.length)
    return conflictResponse(res, { sid: req.schoolId, teacher_id: n.teacher_id, class_id: cur.class_id, subject_id: n.subject_id, day: n.day_of_week, period: n.period_number, cur }, an);
  const lock = "pinned" in req.body ? (req.body.pinned ? "manual" : null) : cur.lock_kind;
  db.prepare("UPDATE schedule SET teacher_id=?, subject_id=?, day_of_week=?, period_number=?, lock_kind=? WHERE id=? AND school_id=?")
    .run(n.teacher_id, n.subject_id, n.day_of_week, n.period_number, lock, cur.id, req.schoolId);
  audit(req.schoolId, "schedule_edit", { id: cur.id, from: cur, to: n });
  res.json({ ...joined(cur.id, req.schoolId), warnings: softWarnings(req.schoolId, cur.class_id, n.subject_id, n.day_of_week) });
});

// تبديل مكان حصتين
router.post("/swap", requireDraft, (req, res) => {
  const sid = req.schoolId;
  const a = owned("schedule", req.body.a, sid);
  const b = owned("schedule", req.body.b, sid);
  if (!a || !b) return res.status(404).json({ error: "إحدى الحصتين غير موجودة" });
  const ex = [a.id, b.id];
  const e1 = analyze({ sid, teacher_id: a.teacher_id, class_id: a.class_id, day: b.day_of_week, period: b.period_number, excludeIds: ex });
  const e2 = analyze({ sid, teacher_id: b.teacher_id, class_id: b.class_id, day: a.day_of_week, period: a.period_number, excludeIds: ex });
  if (e1.invalid || e2.invalid || e1.conflicts.length || e2.conflicts.length) {
    const conflicts = [...e1.conflicts, ...e2.conflicts];
    const error = e1.invalid || e2.invalid || conflicts.map((c) => c.message).join(" — ");
    let suggestions = [];
    if (!e1.invalid && !e2.invalid) {
      // لو لم يمكن التبديل: اقتراحات لنقل الحصة المسحوبة إلى مكان آخر مناسب (نفس اليوم/يوم آخر/درس آخر + سلاسل نقل)
      const real = analyze({ sid, teacher_id: a.teacher_id, class_id: a.class_id, day: b.day_of_week, period: b.period_number, excludeIds: [a.id] });
      suggestions = suggest({ sid, teacher_id: a.teacher_id, class_id: a.class_id, subject_id: a.subject_id, day: b.day_of_week, period: b.period_number, cur: a, conflicts: real.conflicts });
    }
    return res.status(409).json({ error, conflicts, suggestions });
  }
  db.transaction(() => {
    const up = db.prepare("UPDATE schedule SET day_of_week=?, period_number=? WHERE id=?");
    up.run(a.day_of_week, -a.id, a.id); // موضع مؤقت لتفادي القيد الفريد
    up.run(a.day_of_week, a.period_number, b.id); // b إلى مكان a
    up.run(b.day_of_week, b.period_number, a.id); // a إلى مكان b
  })();
  audit(sid, "schedule_swap", { a: a.id, b: b.id });
  res.json({ ok: true });
});

// تنفيذ عدة نقلات متتالية كوحدة واحدة (تُلغى كلها إن فشلت إحداها)
router.post("/chain", requireDraft, (req, res) => {
  const sid = req.schoolId, steps = req.body.steps;
  if (!Array.isArray(steps) || !steps.length || steps.length > 4) return res.status(400).json({ error: "خطوات غير صحيحة" });
  try {
    db.transaction(() => {
      steps.forEach((st, i) => {
        const cur = owned("schedule", st.id, sid);
        if (!cur) throw new Error(`الخطوة ${i + 1}: الحصة غير موجودة`);
        const n = { teacher_id: st.teacher_id ?? cur.teacher_id, subject_id: st.subject_id ?? cur.subject_id, day: Number(st.day_of_week), period: Number(st.period_number) };
        const an = analyze({ sid, teacher_id: n.teacher_id, class_id: cur.class_id, day: n.day, period: n.period, excludeIds: [cur.id] });
        if (an.invalid || an.conflicts.length) throw new Error(`الخطوة ${i + 1}: ${an.invalid || an.conflicts.map((c) => c.message).join(" — ")}`);
        db.prepare("UPDATE schedule SET teacher_id=?, subject_id=?, day_of_week=?, period_number=? WHERE id=? AND school_id=?").run(n.teacher_id, n.subject_id, n.day, n.period, cur.id, sid);
      });
    })();
  } catch (e) { return res.status(409).json({ error: e.message, conflicts: [], suggestions: [] }); }
  audit(sid, "schedule_chain", { steps });
  res.json({ ok: true });
});

// تثبيت/إلغاء تثبيت حصة (لا تتغيّر عند إعادة التوليد)
// تثبيت/إلغاء تثبيت مجموعة حصص: كل المدرسة، أو صف، أو معلم
router.post("/pin-all", requireDraft, (req, res) => {
  const pinned = !!req.body.pinned;
  const where = ["school_id=?"], args = [req.schoolId];
  if (req.body.class_id) { if (!owned("classes", req.body.class_id, req.schoolId)) return res.status(404).json({ error: "الصف غير موجود" }); where.push("class_id=?"); args.push(Number(req.body.class_id)); }
  if (req.body.teacher_id) { if (!owned("teachers", req.body.teacher_id, req.schoolId)) return res.status(404).json({ error: "المعلم غير موجود" }); where.push("teacher_id=?"); args.push(Number(req.body.teacher_id)); }
  const r = pinned
    ? db.prepare(`UPDATE schedule SET lock_kind='manual' WHERE ${where.join(" AND ")} AND IFNULL(lock_kind,'')<>'manual'`).run(...args)
    : db.prepare(`UPDATE schedule SET lock_kind=NULL WHERE ${where.join(" AND ")} AND lock_kind IS NOT NULL`).run(...args);
  audit(req.schoolId, pinned ? "schedule_pin_all" : "schedule_unpin_all", { changed: Number(r.changes), class_id: req.body.class_id || null, teacher_id: req.body.teacher_id || null });
  res.json({ ok: true, changed: Number(r.changes), pinned });
});

router.post("/:id/pin", requireDraft, (req, res) => {
  const cur = owned("schedule", req.params.id, req.schoolId);
  if (!cur) return res.status(404).json({ error: "الحصة غير موجودة" });
  db.prepare("UPDATE schedule SET lock_kind=? WHERE id=?").run(req.body.pinned ? "manual" : null, cur.id);
  res.json({ ok: true, pinned: !!req.body.pinned });
});

router.delete("/:id", requireDraft, (req, res) => {
  db.prepare("DELETE FROM schedule WHERE id=? AND school_id=?").run(req.params.id, req.schoolId);
  audit(req.schoolId, "schedule_delete", { id: req.params.id });
  res.json({ ok: true });
});

router.delete("/", requireDraft, (req, res) => {
  db.prepare("DELETE FROM schedule WHERE school_id=?").run(req.schoolId);
  audit(req.schoolId, "schedule_clear");
  res.json({ ok: true });
});

// ---------- التوليد الذكي ----------
// يجرّب عدة توزيعات (seed مختلف) ويطبّق الأفضل الذي يختلف عن الجدول الحالي، ويعيد بدائل واقتراحات.
// body: { seed? } — إذا حُدّد seed يُطبَّق ذلك التوزيع بعينه (لتطبيق بديل مقترح).
function prepareInput(sid) {
  const days = svc.getWorkingDays(sid);
  const classes = db.prepare("SELECT * FROM school_classes WHERE school_id = ? ORDER BY id").all(sid);
  const reqRows = db.prepare("SELECT * FROM class_subjects WHERE weekly_periods > 0 AND school_id = ?").all(sid);
  const byId = Object.fromEntries(classes.map((c) => [c.id, c]));
  const assign = {};
  db.prepare("SELECT * FROM teacher_assignments WHERE school_id = ?").all(sid).forEach((a) => {
    (assign[`${a.class_id}-${a.subject_id}`] = assign[`${a.class_id}-${a.subject_id}`] || []).push(a.teacher_id);
  });
  const resolve = svc.periodsResolver(sid);
  const rules = db.prepare("SELECT * FROM fixed_slots WHERE school_id = ?").all(sid);
  const expanded = expandRules(rules, classes, resolve);
  // الحصص المثبّتة يدوياً (📌) تُحفظ كما هي وتأخذ الأولوية
  const pins = db.prepare("SELECT * FROM schedule WHERE school_id=? AND lock_kind='manual'").all(sid)
    .map((r) => ({ class_id: r.class_id, day_of_week: r.day_of_week, period_number: r.period_number, subject_id: r.subject_id, teacher_id: r.teacher_id, lock_kind: "manual" }));
  return {
    classes, days, byId, expandedIssues: expanded.issues,
    base: {
      classes, days,
      periodsFor: (cid, d) => resolve(byId[cid], d),
      requirements: reqRows.map((r) => ({ class_id: r.class_id, subject_id: r.subject_id, weekly: r.weekly_periods, allowRepeat: !!r.allow_same_day_repeat, maxPerDay: r.max_per_day })),
      teachersFor: (cid, sub) => assign[`${cid}-${sub}`] || [],
      fixed: [...pins, ...expanded.fixed],
    },
    reqRows,
  };
}

function diffPercent(prevSig, sig) {
  const keys = new Set([...Object.keys(sig)]);
  if (!Object.keys(prevSig).length || !keys.size) return 100;
  let diff = 0;
  keys.forEach((k) => { if (prevSig[k] !== sig[k]) diff++; });
  return Math.round((diff / keys.size) * 100);
}

function buildSuggestions(sid, result, input) {
  const cn = Object.fromEntries(input.classes.map((c) => [c.id, c.name]));
  const sn = Object.fromEntries(db.prepare("SELECT id,name FROM subjects WHERE school_id=?").all(sid).map((x) => [x.id, x.name]));
  const teachers = db.prepare("SELECT id,name FROM teachers WHERE school_id=?").all(sid);
  const load = {};
  result.placements.forEach((p) => (load[p.teacher_id] = (load[p.teacher_id] || 0) + 1));
  const assigned = {};
  db.prepare("SELECT * FROM teacher_assignments WHERE school_id=?").all(sid).forEach((a) => ((assigned[`${a.class_id}-${a.subject_id}`] = assigned[`${a.class_id}-${a.subject_id}`] || []).push(a.teacher_id)));
  const lightest = teachers.slice().sort((a, b) => (load[a.id] || 0) - (load[b.id] || 0));
  const resolve = svc.periodsResolver(sid);
  const out = [], seen = new Set();
  const add = (level, text) => { if (!seen.has(text) && out.length < 14) { seen.add(text); out.push({ level, text }); } };
  const issues = [...result.issues, ...input.expandedIssues];
  issues.forEach((i) => {
    const C = cn[i.class_id] || "", S = sn[i.subject_id] || "";
    if (i.type === "no_teacher") add("error", `الصف ${C}: لا يوجد معلم لمادة «${S}» (ناقص ${i.missing} حصة). اربط معلماً بها من صفحة «توزيع المواد».`);
    else if (i.type === "repeat_needed") add("warn", `الصف ${C}: مادة «${S}» تحتاج حصصاً أكثر من أيام الدوام. فعّل «تكرار الحصة بنفس اليوم» أو قلّل الحصص الأسبوعية.`);
    else if (i.type === "no_room") {
      const total = input.reqRows.filter((r) => r.class_id === i.class_id).reduce((a, r) => a + r.weekly_periods, 0);
      const cls = input.byId[i.class_id];
      const cap = input.days.reduce((a, d) => a + resolve(cls, d), 0);
      add("error", `الصف ${C}: مجموع الحصص المطلوبة ${total} والدروس المتاحة ${cap} فقط. زد عدد دروس بعض الأيام من «إعدادات الدوام» أو قلّل حصص «${S}».`);
    } else if (i.type === "teacher_conflict") {
      const names = (assigned[`${i.class_id}-${i.subject_id}`] || []).map((id) => (teachers.find((t) => t.id === id) || {}).name).filter(Boolean);
      const free = lightest.filter((t) => !(assigned[`${i.class_id}-${i.subject_id}`] || []).includes(t.id)).slice(0, 2).map((t) => `«${t.name}» (${load[t.id] || 0} حصة)`);
      add("error", `الصف ${C}: «${S}» ناقصة ${i.missing} حصة لأن ${names.length ? "المعلم " + names.map((n) => `«${n}»`).join(" و") : "المعلم"} مشغول بنفس الأوقات. ${free.length ? "اربط معلماً إضافياً مثل " + free.join(" أو ") + " بهذه المادة." : "اربط معلماً إضافياً بهذه المادة."}`);
    } else if (i.type === "fixed_conflict") add("warn", `تثبيت ${C ? "الصف " + C : ""} — ${slotLabel(i.day_of_week, i.period_number)}: ${i.message}.`);
    else if (i.type === "fixed_no_teacher") add("warn", `تثبيت الصف ${C} («${S}») لم يُطبَّق: لا يوجد معلم مرتبط بالمادة متاح بذلك الوقت.`);
    else if (i.type === "fixed_invalid") add("warn", `تثبيت الصف ${C} («${S}») لم يُطبَّق: ${i.message}.`);
  });
  if (!out.length) add("ok", result.completion === 100 ? "الجدول مكتمل بدون مشاكل ✅ — اضغط «توزيع جديد» لتجربة ترتيب مختلف وقارن بين البدائل." : "راجع تقرير المشاكل أدناه.");
  return out;
}

router.post("/auto-generate", requireDraft, (req, res) => {
  const sid = req.schoolId;
  const input = prepareInput(sid);
  if (!input.classes.length) return res.status(400).json({ error: "ضيف الصفوف أولاً (من صفحة الصفوف والشعب)" });
  if (!input.days.length) return res.status(400).json({ error: "حدد أيام الدوام أولاً" });
  if (!input.reqRows.length) return res.status(400).json({ error: "حدد مواد الصفوف وعدد حصصها الأسبوعي من صفحة «توزيع المواد»" });

  const prev = {};
  db.prepare("SELECT * FROM schedule WHERE school_id=?").all(sid).forEach((r) => (prev[`${r.class_id}-${r.day_of_week}-${r.period_number}`] = r.subject_id));

  const wanted = req.body && Number(req.body.seed);
  const allowPartial = !!(req.body && req.body.allowPartial);
  const base = (Date.now() % 1000000) + 1;
  const isFull = (r) => r.filled === r.required;
  const cands = [];
  let attempts = 0, bestPartial = null;
  if (wanted) {
    const r = generate({ ...input.base, seed: wanted });
    attempts = 1;
    cands.push({ seed: wanted, r, diff: diffPercent(prev, r.signature) });
  } else {
    // يجرّب توزيعات كثيرة ولا يقبل إلا الجداول المكتملة 100% (بدون حصص ناقصة)
    const t0 = Date.now(), seen = new Set();
    while (attempts < 150 && cands.length < 10 && Date.now() - t0 < 5000) {
      const seed = base + attempts * 7919; attempts++;
      const r = generate({ ...input.base, seed });
      if (isFull(r)) {
        const sig = JSON.stringify(Object.entries(r.signature).sort());
        if (seen.has(sig)) continue;
        seen.add(sig);
        cands.push({ seed, r, diff: diffPercent(prev, r.signature) });
      } else if (!bestPartial || r.filled > bestPartial.r.filled) bestPartial = { seed, r, diff: diffPercent(prev, r.signature) };
    }
  }
  const full = cands.filter((c) => isFull(c.r));
  full.sort((x, y) => y.r.score - x.r.score || y.diff - x.diff || x.r.softViolations - y.r.softViolations);

  // لا يوجد جدول مكتمل: لا نستبدل الجدول الحالي، ونشرح السبب
  if (!full.length && !allowPartial) {
    const worst = bestPartial || cands.sort((x, y) => y.r.filled - x.r.filled)[0];
    return res.json({
      applied: false, attempts,
      filled: worst.r.filled, required: worst.r.required, unfilled: worst.r.required - worst.r.filled,
      score: worst.r.score, softViolations: worst.r.softViolations, seed: worst.seed, alternatives: [], keptManual: 0,
      suggestions: buildSuggestions(sid, worst.r, input),
      message: `لم أجد توزيعاً مكتملاً 100% بعد ${attempts} محاولة — الجدول الحالي لم يتغيّر. أفضل نتيجة: ${worst.r.filled} من ${worst.r.required} حصة. طبّق الحلول المقترحة ثم أعد التوليد.`,
    });
  }
  const best = full[0] || (bestPartial || cands[0]);
  const alts = full.filter((c) => c !== best).slice(0, 3);

  const keptManual = input.base.fixed.filter((f) => f.lock_kind === "manual").length;
  db.transaction(() => {
    db.prepare("DELETE FROM schedule WHERE school_id = ?").run(sid);
    const ins = db.prepare("INSERT INTO schedule (school_id, teacher_id, class_id, subject_id, day_of_week, period_number, lock_kind) VALUES (?,?,?,?,?,?,?)");
    best.r.placements.forEach((p) => ins.run(sid, p.teacher_id, p.class_id, p.subject_id, p.day_of_week, p.period_number, p.lock_kind || null));
  })();
  audit(sid, "schedule_generated", { filled: best.r.filled, required: best.r.required, score: best.r.score, seed: best.seed, attempts });

  res.json({
    applied: true, attempts,
    filled: best.r.filled, required: best.r.required, unfilled: best.r.required - best.r.filled,
    score: best.r.score, softViolations: best.r.softViolations, seed: best.seed, diffPercent: best.diff, keptManual,
    alternatives: alts.map((c) => ({ seed: c.seed, score: c.r.score, filled: c.r.filled, unfilled: c.r.required - c.r.filled, softViolations: c.r.softViolations, diffPercent: c.diff })),
    suggestions: buildSuggestions(sid, best.r, input),
    report: buildValidationReport(sid),
  });
});

module.exports = router;
module.exports.fetchFullSchedule = fetchFullSchedule;
module.exports.buildValidationReport = buildValidationReport;
