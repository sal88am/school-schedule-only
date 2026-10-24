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

  // يعمل على placements بعد انتهاء الجدولة الأساسية: سلاسل إزاحة (نقل/تبديل/تغيير معلم) لسدّ النقص
  function repairDeficits() {
    const key = (d, p) => `${d}-${p}`;
    const occ = {}, tb = {}, dc = {};
    const reqMap = {};
    requirements.forEach((r) => { if (r.weekly > 0) reqMap[`${r.class_id}-${r.subject_id}`] = r; });
    const capOf = (r) => (r.allowRepeat ? Math.max(1, r.maxPerDay || 2) : 1);
    const clsById = Object.fromEntries(classes.map((c) => [c.id, c]));
    const dk = (pl) => `${pl.class_id}-${pl.subject_id}-${pl.day_of_week}`;
    const put = (pl) => { (occ[pl.class_id] = occ[pl.class_id] || {})[key(pl.day_of_week, pl.period_number)] = pl; (tb[pl.teacher_id] = tb[pl.teacher_id] || {})[key(pl.day_of_week, pl.period_number)] = pl; dc[dk(pl)] = (dc[dk(pl)] || 0) + 1; };
    const drop = (pl) => { delete occ[pl.class_id][key(pl.day_of_week, pl.period_number)]; delete tb[pl.teacher_id][key(pl.day_of_week, pl.period_number)]; dc[dk(pl)]--; };
    const countOf = (c, s) => { let n = 0; for (const x of placements) if (x.class_id === c && x.subject_id === s) n++; return n; };
    const dayCnt = (c, s, d) => dc[`${c}-${s}-${d}`] || 0;
    const empty = (c, d, p) => p <= periodsFor(c, d) && !(occ[c] || {})[key(d, p)];
    const reserved = new Set(); // (معلم، خانة) محجوزة لعملية جارية حتى لا تأخذها حركة جانبية
    const tFree = (t, d, p) => !(tb[t] || {})[key(d, p)] && !reserved.has(`${t}|${d}|${p}`);
    const slotsOf = (c) => { const out = []; days.forEach((d) => { for (let p = 1; p <= periodsFor(c, d); p++) out.push([d, p]); }); return out; };
    const shuffled = (a) => { const b = a.slice(); if (seed) for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    const place = (c, s, d, p, t) => { const pl = { teacher_id: t, class_id: c, subject_id: s, day_of_week: d, period_number: p, lock_kind: null }; placements.push(pl); put(pl); return pl; };
    const movable = (pl) => !pl.lock_kind && !!reqMap[`${pl.class_id}-${pl.subject_id}`];
    const capOk = (c, s, d) => { const r = reqMap[`${c}-${s}`]; return !r || dayCnt(c, s, d) < capOf(r); };
    placements.forEach(put);
    const DEPTH = 4;
    const deadline = Date.now() + 400; // حدّ زمني للإصلاح حتى لا يطول مع بيانات مستحيلة
    let steps = 0;
    const over = () => steps > 3000 || Date.now() > deadline;

    // نقل حصة إلى خانة فارغة بصفّها (قد تُزيح حصة معلمها مشغول بسلسلة)
    function tryMove(pl, d, p, depth, vis) {
      steps++; if (over()) return false;
      if (!movable(pl) || !empty(pl.class_id, d, p)) return false;
      const od = pl.day_of_week, op = pl.period_number, ot = pl.teacher_id;
      drop(pl);
      const restore = () => { pl.day_of_week = od; pl.period_number = op; pl.teacher_id = ot; put(pl); return false; };
      if (d !== od && !capOk(pl.class_id, pl.subject_id, d)) return restore();
      const ts = teachersFor(pl.class_id, pl.subject_id);
      const ordered = [ot, ...ts.filter((x) => x !== ot)].filter((x) => ts.includes(x));
      for (const t of ordered) if (tFree(t, d, p)) { pl.day_of_week = d; pl.period_number = p; pl.teacher_id = t; put(pl); return true; }
      if (depth > 0) {
        for (const t of shuffled(ordered)) {
          const Z = (tb[t] || {})[key(d, p)];
          if (!Z || vis.has(Z) || !movable(Z)) continue;
          vis.add(Z);
          const rk = `${t}|${d}|${p}`; reserved.add(rk);
          // معلم بديل لـ Z بنفس الخانة
          const alt = teachersFor(Z.class_id, Z.subject_id).find((y) => y !== t && tFree(y, d, p));
          if (alt !== undefined) { reserved.delete(rk); drop(Z); Z.teacher_id = alt; put(Z); pl.day_of_week = d; pl.period_number = p; pl.teacher_id = t; put(pl); return true; }
          for (const [d2, p2] of shuffled(slotsOf(Z.class_id))) {
            if (!empty(Z.class_id, d2, p2)) continue;
            if (tryMove(Z, d2, p2, depth - 1, vis)) { reserved.delete(rk); pl.day_of_week = d; pl.period_number = p; pl.teacher_id = t; put(pl); return true; }
          }
          reserved.delete(rk);
          vis.delete(Z);
        }
      }
      return restore();
    }

    // تبديل حصتين من نفس الصف (مكانهما) — avoid: معلم يجب ألا يُستخدم في خانة معيّنة
    function trySwap(A, B, avoid) {
      if (!movable(A) || !movable(B) || A.class_id !== B.class_id || A === B) return false;
      const a = [A.day_of_week, A.period_number, A.teacher_id], b = [B.day_of_week, B.period_number, B.teacher_id];
      drop(A); drop(B);
      const back = () => { A.day_of_week = a[0]; A.period_number = a[1]; A.teacher_id = a[2]; B.day_of_week = b[0]; B.period_number = b[1]; B.teacher_id = b[2]; put(A); put(B); return false; };
      if (a[0] !== b[0] && (!capOk(A.class_id, A.subject_id, b[0]) || !capOk(B.class_id, B.subject_id, a[0]))) return back();
      const ta = teachersFor(A.class_id, A.subject_id).find((t) => tFree(t, b[0], b[1]) && !(avoid && avoid(t, b[0], b[1])));
      if (ta === undefined) return back();
      const tbb = teachersFor(B.class_id, B.subject_id).find((t) => tFree(t, a[0], a[1]) && !(avoid && avoid(t, a[0], a[1])) && !(t === ta && a[0] === b[0] && a[1] === b[1]));
      if (tbb === undefined) return back();
      A.day_of_week = b[0]; A.period_number = b[1]; A.teacher_id = ta; put(A);
      B.day_of_week = a[0]; B.period_number = a[1]; B.teacher_id = tbb; put(B);
      return true;
    }

    function simpleFill(c, s) {
      const r = reqMap[`${c}-${s}`], ts = teachersFor(c, s);
      for (const [d, p] of shuffled(slotsOf(c))) {
        if (!empty(c, d, p) || !capOk(c, s, d)) continue;
        const t = ts.find((x) => tFree(x, d, p)); if (t !== undefined) { place(c, s, d, p, t); return true; }
      }
      return false;
    }

    function fillOne(c, s) {
      const ts = teachersFor(c, s);
      if (!ts.length) return false;
      steps = 0; if (Date.now() > deadline) return false;
      if (simpleFill(c, s)) return true;
      // ب) خانة فارغة لكن المعلم مشغول: أزِح الحصة المانعة
      const slots = shuffled(slotsOf(c)).filter(([d, p]) => empty(c, d, p) && capOk(c, s, d));
      for (const [d, p] of slots) for (const t of shuffled(ts)) {
        if (over()) return false;
        const X = (tb[t] || {})[key(d, p)]; if (!X || !movable(X)) continue;
        const vis = new Set([X]);
        const alt = teachersFor(X.class_id, X.subject_id).find((y) => y !== t && tFree(y, d, p));
        if (alt !== undefined) { drop(X); X.teacher_id = alt; put(X); place(c, s, d, p, t); return true; }
        const rk = `${t}|${d}|${p}`; reserved.add(rk);
        for (const [d2, p2] of shuffled(slotsOf(X.class_id))) {
          if (empty(X.class_id, d2, p2)) { if (tryMove(X, d2, p2, DEPTH, vis)) { reserved.delete(rk); place(c, s, d, p, t); return true; } }
          else {
            const W = occ[X.class_id][key(d2, p2)];
            if (W && W !== X && trySwap(X, W)) { reserved.delete(rk); if ((tb[t] || {})[key(d, p)]) { trySwap(X, W); reserved.add(rk); continue; } place(c, s, d, p, t); return true; }
          }
        }
        reserved.delete(rk);
      }
      // ج) الخانات الفارغة محجوبة بسقف اليوم: حرّك إحدى حصص المادة أو بدّلها مع مادة أخرى
      const mine = placements.filter((x) => x.class_id === c && x.subject_id === s && movable(x));
      for (const Y of shuffled(mine)) {
        if (over()) return false;
        for (const [d2, p2] of shuffled(slotsOf(c))) {
          if (empty(c, d2, p2)) { if (tryMove(Y, d2, p2, DEPTH, new Set([Y])) && simpleFill(c, s)) return true; }
        }
        for (const W of shuffled(placements.filter((x) => x.class_id === c && x !== Y))) {
          if (trySwap(Y, W) && simpleFill(c, s)) return true;
        }
      }
      return false;
    }

    for (let round = 0; round < 8; round++) {
      let progress = false;
      for (const cls of classes) {
        for (const r of requirements) {
          if (r.class_id !== cls.id || r.weekly <= 0) continue;
          const target = Math.min(r.weekly, days.length * capOf(r));
          let guard = 0;
          while (countOf(cls.id, r.subject_id) < target && guard++ < 40) { if (!fillOne(cls.id, r.subject_id)) break; progress = true; }
        }
      }
      if (!progress) break;
    }

    // إعادة حساب ما تحقق وتنقية المشاكل
    let filledNow = 0;
    requirements.forEach((r) => { if (r.weekly > 0 && clsById[r.class_id]) filledNow += Math.min(countOf(r.class_id, r.subject_id), r.weekly); });
    for (let i = issues.length - 1; i >= 0; i--) {
      const it = issues[i];
      if (it.type !== "teacher_conflict" && it.type !== "no_room") continue;
      const r = reqMap[`${it.class_id}-${it.subject_id}`]; if (!r) continue;
      const left = Math.max(0, Math.min(r.weekly, days.length * capOf(r)) - countOf(it.class_id, it.subject_id));
      if (!left) issues.splice(i, 1); else it.missing = left;
    }
    return { filled: filledNow };
  }

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

  // ---- 4) إصلاح عام: سدّ النقص بنقل حصص صفوف أخرى أو تبديل معلميها (سلاسل إزاحة) ----
  const repaired = repairDeficits();
  const filled = repaired.filled;
  const completion = required ? Math.round((filled / required) * 100) : 100;
  const score = Math.max(0, completion - softViolations * 2);
  const signature = {};
  placements.forEach((p) => (signature[`${p.class_id}-${p.day_of_week}-${p.period_number}`] = p.subject_id));
  return { placements, issues, softViolations, required, filled, completion, score, signature };
}

module.exports = { generate };
