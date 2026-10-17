// تحويل قواعد «الدروس المثبتة» إلى خانات محددة (صف + يوم + رقم درس)
// period_number = 0 يعني «الدرس الأخير» لذلك الصف في ذلك اليوم.
function expandRules(rules, classes, resolve) {
  const fixed = [], issues = [];
  rules.forEach((r) => {
    const targets = r.class_id ? classes.filter((c) => c.id === r.class_id) : classes;
    targets.forEach((cls) => {
      const n = resolve(cls, r.day_of_week);
      const p = r.period_number === 0 ? n : r.period_number;
      if (!n || p < 1 || p > n) {
        issues.push({ type: "fixed_invalid", class_id: cls.id, subject_id: r.subject_id, day_of_week: r.day_of_week, period_number: p,
          teacher_id: r.teacher_id || null, missing: 0, message: "يوم التثبيت ليس يوم دوام لهذا الصف أو رقم الدرس أكبر من عدد دروسه" });
        return;
      }
      fixed.push({ class_id: cls.id, day_of_week: r.day_of_week, period_number: p, subject_id: r.subject_id, teacher_id: r.teacher_id || null, lock_kind: "rule", rule_id: r.id });
    });
  });
  return { fixed, issues };
}
module.exports = { expandRules };
