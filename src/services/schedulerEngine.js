// محرك الجدولة الذكي — دالة نقية (بدون قاعدة بيانات) لتسهيل الاختبار.
//
// المدخلات:
//   classes:      [{ id }]
//   days:         [0,1,2,...]  أيام الدوام
//   periodsFor:   (classId, day) => عدد الحصص
//   requirements: [{ class_id, subject_id, weekly, allowRepeat, maxPerDay }]
//   teachersFor:  (classId, subjectId) => [teacherId...]
// المخرجات: { placements, issues, softViolations, required, filled, score }

function generate({ classes, days, periodsFor, requirements, teachersFor }) {
  const placements = [];
  const issues = [];
  let softViolations = 0;

  const teacherBusy = new Set(); // `${t}-${d}-${p}`
  const teacherLoad = {};
  const busyKey = (t, d, p) => `${t}-${d}-${p}`;

  let required = 0;

  classes.forEach((cls, classIndex) => {
    const reqs = requirements.filter((r) => r.class_id === cls.id && r.weekly > 0);
    const grid = {}; // `${d}-${p}` => subject_id
    const placedCount = {}; // subject => total
    const dayCount = {}; // `${subject}-${day}` => n
    const cap = {};
    reqs.forEach((r) => {
      required += r.weekly;
      placedCount[r.subject_id] = 0;
      cap[r.subject_id] = r.allowRepeat ? Math.max(1, r.maxPerDay || 2) : 1;
    });

    // ---- 1) توزيع حصص كل مادة على الأيام (بالتساوي، وبسقف يومي) ----
    const quota = {}; // `${subject}-${day}`
    const dayFree = {};
    days.forEach((d) => (dayFree[d] = periodsFor(cls.id, d)));
    const ordered = reqs.slice().sort((a, b) => b.weekly - a.weekly);

    ordered.forEach((r, ri) => {
      const sid = r.subject_id;
      const teachers = teachersFor(cls.id, sid);
      if (!teachers.length) {
        issues.push({ type: "no_teacher", class_id: cls.id, subject_id: sid, missing: r.weekly,
          message: "لا يوجد معلم مرتبط بهذه المادة في هذا الصف" });
        return;
      }
      const maxPossible = days.length * cap[sid];
      if (r.weekly > maxPossible) {
        issues.push({ type: "repeat_needed", class_id: cls.id, subject_id: sid, missing: r.weekly - maxPossible,
          message: `عدد الحصص الأسبوعي (${r.weekly}) أكثر مما يسمح به السقف اليومي — فعّل تكرار الحصة بنفس اليوم` });
      }
      let remaining = Math.min(r.weekly, maxPossible);
      const rot = (classIndex + ri) % days.length;
      const dayOrder = days.map((_, i) => days[(i + rot) % days.length]);
      let guard = 0;
      while (remaining > 0 && guard++ < 1000) {
        let progressed = false;
        for (const d of dayOrder) {
          if (remaining <= 0) break;
          const k = `${sid}-${d}`;
          if ((quota[k] || 0) >= cap[sid]) continue;
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
      teachers.sort((a, b) => (teacherLoad[a] || 0) - (teacherLoad[b] || 0));
      const t = teachers[0];
      teacherBusy.add(busyKey(t, day, period));
      teacherLoad[t] = (teacherLoad[t] || 0) + 1;
      grid[`${day}-${period}`] = sid;
      placedCount[sid]++;
      dayCount[`${sid}-${day}`] = (dayCount[`${sid}-${day}`] || 0) + 1;
      placements.push({ teacher_id: t, class_id: cls.id, subject_id: sid, day_of_week: day, period_number: period });
      return true;
    }

    days.forEach((d) => {
      const P = periodsFor(cls.id, d);
      const left = {};
      reqs.forEach((r) => { left[r.subject_id] = quota[`${r.subject_id}-${d}`] || 0; });
      let last = null;
      for (let p = 1; p <= P; p++) {
        const cands = reqs
          .filter((r) => left[r.subject_id] > 0 && teachersFor(cls.id, r.subject_id).some((t) => !teacherBusy.has(busyKey(t, d, p))))
          .map((r) => {
            let score = 0;
            if (r.subject_id === last) score += left[r.subject_id] > 0 && r.allowRepeat ? 50 : -100; // تكرار متتالٍ مقبول فقط إذا مسموح
            else if (last !== null && left[last] > 0 && reqs.find((x) => x.subject_id === last).allowRepeat) score -= 5;
            score += left[r.subject_id] * 3;
            score -= teachersFor(cls.id, r.subject_id).length; // الأكثر تقييداً أولاً
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
      if (placedCount[sid] < r.weekly && !issues.some((i) => i.class_id === cls.id && i.subject_id === sid)) {
        issues.push({ type: "teacher_conflict", class_id: cls.id, subject_id: sid, missing: r.weekly - placedCount[sid],
          message: "تعذّر إكمال الحصص بسبب انشغال المعلم في صفوف أخرى" });
      } else if (placedCount[sid] < target) {
        issues.push({ type: "teacher_conflict", class_id: cls.id, subject_id: sid, missing: target - placedCount[sid],
          message: "تعذّر إكمال الحصص بسبب انشغال المعلم في صفوف أخرى" });
      }
    });
  });

  const filled = placements.length;
  const completion = required ? Math.round((filled / required) * 100) : 100;
  const score = Math.max(0, completion - softViolations * 2);
  return { placements, issues, softViolations, required, filled, completion, score };
}

module.exports = { generate };
