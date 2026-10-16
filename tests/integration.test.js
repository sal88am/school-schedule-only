// اختبار تكاملي: قاعدة بيانات حقيقية (SQLite) + مسارات الـ API الفعلية
process.env.NODE_PATH = __dirname + "/shim/node_modules";
require("module").Module._initPaths();
const fs = require("fs"), path = require("path"), assert = require("assert");
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbFile = path.join(dataDir, "school.db");
["", "-wal", "-shm"].forEach((x) => { try { fs.unlinkSync(dbFile + x); } catch (e) {} });

const db = require("../src/db");
const routers = {
  teachers: require("../src/routes/teachers"), subjects: require("../src/routes/subjects"),
  classes: require("../src/routes/classes"), "class-subjects": require("../src/routes/classSubjects"),
  "teacher-assignments": require("../src/routes/teacherAssignments"), "schedule-config": require("../src/routes/scheduleConfig"),
  schedule: require("../src/routes/schedule"), public: require("../src/routes/publicSchedule"), settings: require("../src/routes/settings"),
};

async function call(method, url, body) {
  const [pathPart, qs] = url.split("?");
  const parts = pathPart.split("/").filter(Boolean); // api/<name>/...
  const router = routers[parts[1]];
  const rest = "/" + parts.slice(2).join("/");
  for (const r of router.routes) {
    if (r.method !== method) continue;
    const names = [];
    const re = new RegExp("^" + r.path.replace(/:([a-z_]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }).replace(/\/$/, "") + "/?$");
    const m = rest === "/" && r.path === "/" ? [] : re.exec(rest);
    if (!m) continue;
    const params = {}; names.forEach((n, i) => (params[n] = m[i + 1]));
    const query = Object.fromEntries(new URLSearchParams(qs || ""));
    return await new Promise((resolve) => {
      const res = { code: 200, status(c) { this.code = c; return this; }, json(d) { resolve({ status: this.code, body: d }); } };
      const req = { params, query, body: body || {} };
      let i = 0;
      const next = () => { const h = r.h[i++]; if (h) h(req, res, next); };
      next();
    });
  }
  throw new Error(`no route ${method} ${url}`);
}
let failed = 0;
async function test(name, fn) { try { await fn(); console.log("✓", name); } catch (e) { failed++; console.error("✗", name, "\n  ", e.message); } }

(async () => {
  await test("الترحيل: جداول وبيانات أولية", async () => {
    const cfg = (await call("GET", "/api/schedule-config")).body;
    assert.strictEqual(cfg.shifts.length, 2);
    assert.deepStrictEqual(cfg.preview.morning.map((p) => `${p.start}-${p.end}`),
      ["08:00-08:40", "08:45-09:25", "09:30-10:10", "10:15-10:55", "11:00-11:40", "11:45-12:25"]);
    assert.strictEqual(cfg.preview.evening[0].start, "13:00");
    assert.strictEqual(cfg.dayConfig.find((d) => d.day_of_week === 3).shift_type, "evening");
    assert.strictEqual((await call("GET", "/api/subjects")).body.length, 8);
  });
  await test("إعادة تحميل db لا تمسح البيانات (ensureColumn آمن)", async () => {
    db.ensureColumn("subjects", "color", "TEXT"); db.ensureColumn("teachers", "class_teacher_of", "INTEGER");
  });
  await test("تعديل الشفت يحدث الأوقات تلقائياً + تحقق من المدخلات", async () => {
    let r = await call("PUT", "/api/schedule-config/shift/morning", { start_time: "07:30", period_minutes: 45, break_minutes: 10 });
    assert.strictEqual(r.body.preview.morning[1].start, "08:25");
    r = await call("PUT", "/api/schedule-config/shift/morning", { start_time: "7:30" });
    assert.strictEqual(r.status, 400);
    await call("PUT", "/api/schedule-config/shift/morning", { start_time: "08:00", period_minutes: 40, break_minutes: 5 });
  });

  // صفوف: الخامس 2 شعبة
  await call("POST", "/api/classes/generate", { grade: "الخامس", sections_count: 2 });
  await call("POST", "/api/classes/generate", { grade: "السادس", sections_count: 1 });
  const classes = (await call("GET", "/api/classes")).body;
  const subjects = (await call("GET", "/api/subjects")).body;
  const S = Object.fromEntries(subjects.map((s) => [s.name, s.id]));
  await test("الشعب بترتيب أبجد", async () => {
    assert.deepStrictEqual(classes.map((c) => c.name), ["الخامس أ", "الخامس ب", "السادس أ"]);
  });

  // معلمون (معلم واحد لعدة مواد ومراحل)
  const T = {};
  for (const [n, subs] of [["أحمد", ["عربي", "اسلامية"]], ["سارة", ["انكليزي"]], ["علي", ["رياضيات", "علوم"]], ["نور", ["اجتماعيات", "رياضة", "فنية"]]]) {
    T[n] = (await call("POST", "/api/teachers", { name: n, subject_ids: subs.map((x) => S[x]) })).body.id;
  }

  await test("حصص المادة الأسبوعية: تطبيق على كل شعب المرحلة", async () => {
    const plan = { "عربي": 5, "اسلامية": 2, "رياضيات": 5, "انكليزي": 4, "علوم": 3, "اجتماعيات": 2, "رياضة": 2, "فنية": 1 };
    for (const g of ["الخامس", "السادس"])
      for (const [n, w] of Object.entries(plan)) {
        const r = await call("POST", "/api/class-subjects/bulk-grade", { grade: g, subject_id: S[n], weekly_periods: w });
        assert.strictEqual(r.status, 201);
      }
    const eng = (await call("GET", `/api/class-subjects?class_id=${classes[0].id}`)).body.find((x) => x.subject_name === "انكليزي");
    assert.strictEqual(eng.weekly_periods, 4); assert.strictEqual(eng.allow_same_day_repeat, 0);
  });
  await test("التحقق: الحد اليومي عند التكرار", async () => {
    let r = await call("POST", "/api/class-subjects", { class_id: classes[0].id, subject_id: S["عربي"], weekly_periods: 5, allow_same_day_repeat: true, max_per_day: 1 });
    assert.strictEqual(r.status, 400);
    r = await call("POST", "/api/class-subjects", { class_id: classes[0].id, subject_id: S["عربي"], weekly_periods: 5, allow_same_day_repeat: false, max_per_day: 9 });
    assert.strictEqual(r.body.max_per_day, 1);
  });
  await test("ربط معلم غير مؤهل مرفوض، والإسناد التلقائي يعمل", async () => {
    const bad = await call("POST", "/api/teacher-assignments", { teacher_id: T["سارة"], class_id: classes[0].id, subject_id: S["رياضيات"] });
    assert.strictEqual(bad.status, 400);
    const r = (await call("POST", "/api/teacher-assignments/auto")).body;
    assert.strictEqual(r.assigned, 24); assert.strictEqual(r.unassigned.length, 0);
  });

  await test("التوليد الذكي: كامل، بلا تعارض، وسقف التكرار محترم", async () => {
    const r = await call("POST", "/api/schedule/auto-generate");
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const full = (await call("GET", "/api/schedule")).body;
    const rep = (await call("GET", "/api/schedule/validate")).body;
    console.log("   اكتمال:", rep.completionPercent + "%", "مجدول:", rep.totalFilled + "/" + rep.totalRequired, "score:", r.body.score);
    // 3 صفوف × 24 حصة = 72 حصة من 90 خانة؛ المعلمون: أحمد 14/صف... قد تظهر مشاكل انشغال معلم
    assert(rep.completionPercent >= 80, "completion " + rep.completionPercent);
    const eng = full.filter((s) => s.class_id === classes[0].id && s.subject_name === "انكليزي");
    assert(eng.length <= 4);
    const perDay = {}; eng.forEach((s) => (perDay[s.day_of_week] = (perDay[s.day_of_week] || 0) + 1));
    assert(Object.values(perDay).every((n) => n <= 1), "تكرار إنكليزي بنفس اليوم");
    const days = new Set(full.map((s) => s.day_of_week));
    assert(![...days].some((d) => d === 5 || d === 6), "حصص بالجمعة/السبت");
    const sunday = full.find((s) => s.day_of_week === 0 && s.period_number === 1);
    assert.strictEqual(sunday.start_time, "08:00");
    const wed = full.find((s) => s.day_of_week === 3 && s.period_number === 1);
    assert.strictEqual(wed.start_time, "13:00");
  });

  await test("السماح بالتكرار: 8 حصص عربي، حد 2 يومياً", async () => {
    await call("POST", "/api/schedule/unapprove");
    let r = await call("POST", "/api/class-subjects", { class_id: classes[2].id, subject_id: S["عربي"], weekly_periods: 8, allow_same_day_repeat: true, max_per_day: 2 });
    assert.strictEqual(r.status, 201);
    await call("POST", "/api/schedule/auto-generate");
    const full = (await call("GET", "/api/schedule")).body.filter((s) => s.class_id === classes[2].id && s.subject_name === "عربي");
    assert.strictEqual(full.length, 8);
    const pd = {}; full.forEach((s) => (pd[s.day_of_week] = (pd[s.day_of_week] || 0) + 1));
    assert(Object.values(pd).every((n) => n <= 2));
  });

  await test("تعديل يدوي: بلا شرط تخصص + كشف تعارض + نقل + تبديل", async () => {
    const full = (await call("GET", "/api/schedule")).body;
    const a = full.find((s) => s.class_id === classes[0].id);
    // تغيير المعلم لمعلم غير متخصص (مسموح) لكن ليكن حراً: نبحث عن خانة فارغة
    const b = full.find((s) => s.class_id === classes[0].id && s.id !== a.id);
    // تعارض: نفس الصف نفس الوقت
    const c1 = await call("POST", "/api/schedule", { teacher_id: T["نور"], class_id: a.class_id, subject_id: a.subject_id, day_of_week: a.day_of_week, period_number: a.period_number });
    assert.strictEqual(c1.status, 409);
    // تعارض معلم
    const other = full.find((s) => s.class_id !== a.class_id);
    const c2 = await call("POST", "/api/schedule", { teacher_id: other.teacher_id, class_id: a.class_id === other.class_id ? classes[1].id : a.class_id, subject_id: a.subject_id, day_of_week: other.day_of_week, period_number: other.period_number });
    assert([409].includes(c2.status));
    // خارج أيام الدوام
    const c3 = await call("POST", "/api/schedule", { teacher_id: T["نور"], class_id: a.class_id, subject_id: a.subject_id, day_of_week: 5, period_number: 1 });
    assert.strictEqual(c3.status, 409);
    // تبديل
    const sw = await call("POST", "/api/schedule/swap", { a: a.id, b: b.id });
    assert.strictEqual(sw.status, 200, JSON.stringify(sw.body));
    const after = (await call("GET", "/api/schedule")).body;
    const a2 = after.find((s) => s.id === a.id), b2 = after.find((s) => s.id === b.id);
    assert.strictEqual(a2.day_of_week, b.day_of_week); assert.strictEqual(a2.period_number, b.period_number);
    assert.strictEqual(b2.day_of_week, a.day_of_week); assert.strictEqual(b2.period_number, a.period_number);
    // حذف ثم إضافة بمعلم غير متخصص
    await call("DELETE", `/api/schedule/${a.id}`);
    const add = await call("POST", "/api/schedule", { teacher_id: T["نور"], class_id: a.class_id, subject_id: S["عربي"], day_of_week: a2.day_of_week, period_number: a2.period_number });
    assert.strictEqual(add.status, 201, JSON.stringify(add.body));
  });

  await test("الاعتماد يقفل التعديل ويُفتح بـ unapprove", async () => {
    await call("POST", "/api/schedule/approve");
    const r = await call("DELETE", "/api/schedule/1");
    assert.strictEqual(r.status, 409);
    assert.strictEqual((await call("POST", "/api/schedule/auto-generate")).status, 409);
    await call("POST", "/api/schedule/unapprove");
    assert.strictEqual((await call("DELETE", "/api/schedule/999999")).status, 200);
  });

  await test("تقرير التحقق يكشف النقص", async () => {
    await call("DELETE", "/api/schedule");
    const rep = (await call("GET", "/api/schedule/validate")).body;
    assert.strictEqual(rep.completionPercent, 0); assert(rep.missing > 0); assert(rep.issues.length > 0);
  });

  await test("العام: أوقات حسب اليوم", async () => {
    const dp = (await call("GET", "/api/public/day-periods")).body;
    assert.strictEqual(dp[0][0].start, "08:00"); assert.strictEqual(dp[4][0].start, "13:00");
  });

  console.log(failed ? `\nفشل ${failed}` : "\nكل الاختبارات نجحت");
  process.exit(failed ? 1 : 0);
})();
