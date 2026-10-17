// محرك الجدولة الذكي — دالة نقية (بدون قاعدة بيانات) لتسهيل الاختبار.
//
// المدخلات:
//   classes:      [{ id }]
//   days:         [0,1,2,...]  أيام الدوام
//   periodsFor:   (classId, day) => عدد الحصص
//   requirements: [{ class_id, subject_id, weekly, allowRepeat, maxPerDay }]
//   teachersFor:  (classId, subjectId) => [teacherId...]
//   fixed:        [{ class_id, day_of_week, period_number(>=1), subject_id, teacher_id|null, lock_kind }]  دروس مثبتة تُوضع أولاً
//   seed:         0 = ترتيب ثابت؛ أي رقم آخر = توزيع مختلف (قابل للتكرار بنفس الرقم)
// المخرجات: { placements, issues, softViolations, required, filled, completion, score, signature }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate({ classes, days, periodsFor, requirements, teachersFor, fixed = [], seed = 0 }) {
  const placements = [];
  const issues = [];
  let softViolations = 0;

  const rnd = seed ? mulberry32(seed) : () => 0; // seed=0 → لا عشوائية إطلاقاً
  const teacherBusy = new Set(); // `${t}-${d}-${p}`
  const teacherLoad = {};
  const busyKey = (t, d, p) => `${t}-${d}-${p}`;

  // ترتيب الصفوف (يتغيّر مع seed) — الصف الأسبق يحصل على أفضلية في حجز المعلمين
  const order = classes.slice();
  if (seed) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }

  // ---- 0) الدروس المثبتة ----
  const fixedGrid = {}; // classId -> { 'd-p': subject_id }
  const pickTeacher = (cid, sid, d, p) => {
    const free = teachersFor(cid, sid).filter((t) => !teacherBusy.has(busyKey(t, d, p)));
    free.sort((a, b) => (teacherLoad[a] || 0) - (teacherLoad[b] || 0) || (rnd() - 0.5));
    return free[0] || null;
  };
  fixed.forEach((f) => {
    const cid = f.class_id, d = f.day_of_week, p = f.period_number, sid = f.subject_id;
    const base = { class_id: cid, subject_id: sid, day_of_week: d, period_number: p, teacher_id: f.teacher_id || null };
    if (!days.includes(d) || p < 1 || p > periodsFor(cid, d)) {
      issues.push({ ...base, type: "fixed_invalid", missing: 0, message: "درس مثبّت خارج أيام الدوام أو خارج عدد دروس ذلك اليوم" });
      return;
    }
    const g = (fixedGrid[cid] = fixedGrid[cid] || {});
    const key = `${d}-${p}`;
    if (g[key]) {
      if (g[key] !== sid) issues.push({ ...base, type: "fixed_conflict", missing: 0, message: "تثبيتان مختلفان لنفس الصف في نفس الدرس" });
      return;
    }
    let t = f.teacher_id || pickTeacher(cid, sid, d, p);
    if (!t) { issues.push({ ...base, type: "fixed_no_teacher", missing: 0, message: "لا يوجد معلم متاح لهذا الدرس المثبّت" }); return; }
    if (teacherBusy.has(busyKey(t, d, p))) {
      const alt = f.teacher_id ? null : pickTeacher(cid, sid, d, p);
      if (!alt) { issues.push({ ...base, teacher_id: t, type: "fixed_conflict", missing: 0, message: "المعلم المحدّد مثبّت في صف آخر بنفس الوقت" }); return; }
      t = alt;
    }
    teacherBusy.add(busyKey(t, d, p));
    teacherLoad[t] = (teacherLoad[t] || 0) + 1;
    g[key] = sid;
    placements.push({ teacher_id: t, class_id: cid, subject_id: sid, day_of_week: d, period_number: p, lock_kind: f.lock_kind || "rule" });
  });

  let required = 0, filledReq = 0;

  order.forEach((cls, classIndex) => {
    const reqs = requirements.filter((r) => r.class_id === cls.id && r.weekly > 0);
    const grid = { ...(fixedGrid[cls.id] || {}) }; // `${d}-${p}` => subject_id
    const placedCount = {}; // subject => total (يشمل المثبّت)
    const dayCount = {}; // `${subject}-${day}` => n
    const cap = {};
    reqs.forEach((r) => {
      required += r.weekly;
      placedCount[r.subject_id] = 0;
      cap[r.subject_id] = r.allowRepeat ? Math.max(1, r.maxPerDay || 2) : 1;
    });
    const fixedDay = {}; // عدد المثبّت في كل يوم
    Object.entries(grid).forEach(([k, sid]) => {
      const d = Number(k.split("-")[0]);
      fixedDay[d] = (fixedDay[d] || 0) + 1;
      dayCount[`${sid}-${d}`] = (dayCount[`${sid}-${d}`] || 0) + 1;
      if (placedCount[sid] !== undefined) placedCount[sid]++;
    });

    // ---- 1) توزيع حصص كل مادة على الأيام (بالتساوي، وبسقف يومي) ----
    const quota = {}; // `${subject}-${day}`
    const dayFree = {};
    days.forEach((d) => (dayFree[d] = Math.max(0, periodsFor(cls.id, d) - (fixedDay[d] || 0))));
    const ordered = reqs.slice().sort((a, b) => b.weekly - a.weekly || (rnd() - 0.5));

    ordered.forEach((r, ri) => {
      const sid = r.subject_id;
      const teachers = teachersFor(cls.id, sid);
      if (!teachers.length) {
        if (placedCount[sid] < r.weekly)
          issues.push({ type: "no_teacher", class_id: cls.id, subject_id: sid, missing: r.weekly - placedCount[sid],
            message: "لا يوجد معلم مرتبط بهذه المادة في هذا الصف" });
        return;
      }
      const maxPossible = days.length * cap[sid];
      if (r.weekly > maxPossible) {
        issues.push({ type: "repeat_needed", class_id: cls.id, subject_id: sid, missing: r.weekly - maxPossible,
          message: `عدد الحصص الأسبوعي (${r.weekly}) أكثر مما يسمح به السقف اليومي — فعّل تكرار الحصة بنفس اليوم` });
      }
      let remaining = Math.max(0, Math.min(r.weekly, maxPossible) - placedCount[sid]);
      const rot = (classIndex + ri + (seed ? Math.floor(rnd() * days.length) : 0)) % days.length;
      const dayOrder = days.map((_, i) => days[(i + rot) % days.length]);
      let guard = 0;
      while (remaining > 0 && guard++ < 1000) {
        let progressed = false;
        for (const d of dayOrder) {
          if (remaining <= 0) break;
          const k = `${sid}-${d}`;
          if ((quota[k] || 0) + (dayCount[k] || 0) >= cap[sid]) continue;
          if (dayFree[d] <= 0) continue;
          quota[k] = (quota[k] || 0) + 1;
          dayFree[d]--;
          remaining--;
          progressed = true;
        }
        if (!progressed) break;
      }
      if (remaining > 0) {
        issues.push({ type: "no_room", class_id: cls.id, subject_id: sid, missing: remaining,
          message: "لا توجد حصص يومية كافية لاستيعاب كل حصص هذه المادة" });
      }
    });

    // ---- 2) ترتيب الحصص داخل كل يوم ----
    function tryPlace(day, period, sid) {
      const teachers = teachersFor(cls.id, sid).filter((t) => !teacherBusy.has(busyKey(t, day, period)));
      if (!teachers.length) return false;
      teachers.sort((a, b) => (teacherLoad[a] || 0) - (teacherLoad[b] || 0) || (rnd() - 0.5));
      const t = teachers[0];
      teacherBusy.add(busyKey(t, day, period));
      teacherLoad[t] = (teacherLoad[t] || 0) + 1;
      grid[`${day}-${period}`] = sid;
      if (placedCount[sid] !== undefined) placedCount[sid]++;
      dayCount[`${sid}-${day}`] = (dayCount[`${sid}-${day}`] || 0) + 1;
      placements.push({ teacher_id: t, class_id: cls.id, subject_id: sid, day_of_week: day, period_number: period, lock_kind: null });
      return true;
    }

    days.forEach((d) => {
      const P = periodsFor(cls.id, d);
      const left = {};
      reqs.forEach((r) => { left[r.subject_id] = quota[`${r.subject_id}-${d}`] || 0; });
      let last = null;
      for (let p = 1; p <= P; p++) {
        if (grid[`${d}-${p}`]) { last = grid[`${d}-${p}`]; continue; } // درس مثبّت
        const cands = reqs
          .filter((r) => left[r.subject_id] > 0 && teachersFor(cls.id, r.subject_id).some((t) => !teacherBusy.has(busyKey(t, d, p))))
          .map((r) => {
            let score = 0;
            if (r.subject_id === last) score += left[r.subject_id] > 0 && r.allowRepeat ? 50 : -100; // تكرار متتالٍ مقبول فقط إذا مسموح
            else if (last !== null && left[last] > 0 && (reqs.find((x) => x.subject_id === last) || {}).allowRepeat) score -= 5;
            score += left[r.subject_id] * 3;
            score -= teachersFor(cls.id, r.subject_id).length; // الأكثر تقييداً أولاً
            if (seed) score += rnd() * 4; // تنويع التوزيع بين المحاولات
            return { r, score };
          })
          .sort((a, b) => b.score - a.score);
        if (!cands.length) { last = null; continue; }
        const pick = cands[0];
        if (pick.r.subject_id === last && !pick.r.allowRepeat) softViolations++;
        tryPlace(d, p, pick.r.subject_id);
        left[pick.r.subject_id]--;
        last = pick.r.subject_id;
      }
    });

    // ---- 3) إصلاح: ما تبقى من حصص يُوضع في أي فراغ مسموح ----
    reqs.forEach((r) => {
      const sid = r.subject_id;
      if (!teachersFor(cls.id, sid).length) return;
      const target = Math.min(r.weekly, days.length * cap[sid]);
      for (const d of days) {
        if (placedCount[sid] >= target) break;
        const P = periodsFor(cls.id, d);
        for (let p = 1; p <= P && placedCount[sid] < target; p++) {
          if (grid[`${d}-${p}`]) continue;
          if ((dayCount[`${sid}-${d}`] || 0) >= cap[sid]) break;
          tryPlace(d, p, sid);
        }
      }
      if (placedCount[sid] < r.weekly && !issues.some((i) => i.class_id === cls.id && i.subject_id === sid && i.type !== "fixed_invalid")) {
        issues.push({ type: "teacher_conflict", class_id: cls.id, subject_id: sid, missing: r.weekly - placedCount[sid],
          message: "تعذّر إكمال الحصص بسبب انشغال المعلم في صفوف أخرى" });
      } else if (placedCount[sid] < target) {
        issues.push({ type: "teacher_conflict", class_id: cls.id, subject_id: sid, missing: target - placedCount[sid],
          message: "تعذّر إكمال الحصص بسبب انشغال المعلم في صفوف أخرى" });
      }
    });
    reqs.forEach((r) => { filledReq += Math.min(placedCount[r.subject_id] || 0, r.weekly); });
  });

  const filled = filledReq;
  const completion = required ? Math.round((filled / required) * 100) : 100;
  const score = Math.max(0, completion - softViolations * 2);
  const signature = {};
  placements.forEach((p) => (signature[`${p.class_id}-${p.day_of_week}-${p.period_number}`] = p.subject_id));
  return { placements, issues, softViolations, required, filled, completion, score, signature };
}

module.exports = { generate };
