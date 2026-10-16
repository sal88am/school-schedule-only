const assert = require("assert");
const { generate } = require("../src/services/schedulerEngine");

function check(name, fn) { try { fn(); console.log("✓", name); } catch (e) { console.error("✗", name, "\n ", e.message); process.exitCode = 1; } }

function conflicts(pl) {
  const t = new Set(), c = new Set(); let n = 0;
  pl.forEach((p) => {
    const a = `${p.teacher_id}-${p.day_of_week}-${p.period_number}`, b = `${p.class_id}-${p.day_of_week}-${p.period_number}`;
    if (t.has(a) || c.has(b)) n++; t.add(a); c.add(b);
  });
  return n;
}
const count = (pl, cls, sub) => pl.filter((p) => p.class_id === cls && p.subject_id === sub).length;
const perDay = (pl, cls, sub, d) => pl.filter((p) => p.class_id === cls && p.subject_id === sub && p.day_of_week === d).length;

const days = [0, 1, 2, 3, 4];
const periodsFor = () => 6;

check("الخامس: 4 حصص انكليزي أسبوعياً بدون تكرار بنفس اليوم", () => {
  const r = generate({ classes: [{ id: 1 }], days, periodsFor,
    requirements: [{ class_id: 1, subject_id: 10, weekly: 4, allowRepeat: false, maxPerDay: 1 },
                   { class_id: 1, subject_id: 11, weekly: 5, allowRepeat: false, maxPerDay: 1 },
                   { class_id: 1, subject_id: 12, weekly: 5, allowRepeat: false, maxPerDay: 1 },
                   { class_id: 1, subject_id: 13, weekly: 3, allowRepeat: false, maxPerDay: 1 }],
    teachersFor: (c, s) => [s] });
  assert.strictEqual(count(r.placements, 1, 10), 4);
  days.forEach((d) => assert(perDay(r.placements, 1, 10, d) <= 1));
  assert.strictEqual(conflicts(r.placements), 0);
  assert.strictEqual(r.filled, 17);
});

check("8 حصص عربي بدون تكرار: تقرير نقص", () => {
  const r = generate({ classes: [{ id: 1 }], days, periodsFor,
    requirements: [{ class_id: 1, subject_id: 10, weekly: 8, allowRepeat: false, maxPerDay: 1 }],
    teachersFor: () => [1] });
  assert.strictEqual(count(r.placements, 1, 10), 5);
  assert(r.issues.some((i) => i.type === "repeat_needed" && i.missing === 3));
});

check("8 حصص عربي مع السماح بالتكرار (حد 2): كلها تُجدول ومتتالية", () => {
  const r = generate({ classes: [{ id: 1 }], days, periodsFor,
    requirements: [{ class_id: 1, subject_id: 10, weekly: 8, allowRepeat: true, maxPerDay: 2 }],
    teachersFor: () => [1] });
  assert.strictEqual(count(r.placements, 1, 10), 8);
  days.forEach((d) => assert(perDay(r.placements, 1, 10, d) <= 2));
  days.forEach((d) => {
    const ps = r.placements.filter((p) => p.day_of_week === d).map((p) => p.period_number).sort();
    if (ps.length === 2) assert.strictEqual(ps[1] - ps[0], 1, "التكرار يجب أن يكون متتالياً");
  });
});

check("معلم واحد لعدة صفوف: لا تعارض أبداً", () => {
  const classes = [1, 2, 3, 4].map((id) => ({ id }));
  const requirements = [];
  classes.forEach((c) => {
    requirements.push({ class_id: c.id, subject_id: 10, weekly: 4, allowRepeat: false, maxPerDay: 1 });
    requirements.push({ class_id: c.id, subject_id: 11, weekly: 4, allowRepeat: true, maxPerDay: 2 });
    requirements.push({ class_id: c.id, subject_id: 12, weekly: 3, allowRepeat: false, maxPerDay: 1 });
  });
  const r = generate({ classes, days, periodsFor, requirements,
    teachersFor: (c, s) => (s === 10 ? [100] : s === 11 ? [101, 102] : [103]) });
  assert.strictEqual(conflicts(r.placements), 0);
  assert(r.completion >= 90, "completion " + r.completion);
});

check("مادة بلا معلم تظهر كمشكلة", () => {
  const r = generate({ classes: [{ id: 1 }], days, periodsFor,
    requirements: [{ class_id: 1, subject_id: 10, weekly: 3, allowRepeat: false, maxPerDay: 1 }],
    teachersFor: () => [] });
  assert.strictEqual(r.filled, 0);
  assert(r.issues.some((i) => i.type === "no_teacher"));
});

check("عدد الحصص اليومي مختلف حسب الصف (استثناء)", () => {
  const r = generate({ classes: [{ id: 1 }], days, periodsFor: () => 3,
    requirements: [{ class_id: 1, subject_id: 10, weekly: 5, allowRepeat: false, maxPerDay: 1 },
                   { class_id: 1, subject_id: 11, weekly: 5, allowRepeat: false, maxPerDay: 1 },
                   { class_id: 1, subject_id: 12, weekly: 5, allowRepeat: false, maxPerDay: 1 }],
    teachersFor: (c, s) => [s] });
  assert(r.placements.every((p) => p.period_number <= 3));
  assert.strictEqual(r.filled, 15);
});
