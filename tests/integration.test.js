// اختبار تكاملي: التطبيق الحقيقي كاملاً (app.js + المصادقة + العزل) فوق SQLite حقيقي
process.env.NODE_PATH = __dirname + "/shim/node_modules";
require("module").Module._initPaths();
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sijil-")), "school.db");
process.env.DB_PATH = dbFile;
process.env.SUPER_ADMIN_PASSWORD = "SuperSecret123";
process.env.ADMIN_PASSWORD = "DefaultAdmin123";

const app = require("../src/app");
const db = require("../src/db");
const call = (m, u, b, token, extra = {}) => app.dispatch(m, u, b, { ...(token ? { authorization: "Bearer " + token } : {}), ...extra });
const login = async (username, password) => (await call("POST", "/api/auth/login", { username, password }));

let failed = 0;
async function test(name, fn) { try { await fn(); console.log("✓", name); } catch (e) { failed++; console.error("✗", name, "\n  ", e.message); } }
const ok = (r, code = 200) => { assert.strictEqual(r.status, code, `expected ${code} got ${r.status}: ${JSON.stringify(r.body)}`); return r.body; };

(async () => {
  let SUPER, A, B; // tokens
  let schoolA, schoolB;

  await test("الإقلاع: مدرسة افتراضية + مدير عام + مدير مدرسة", async () => {
    SUPER = ok(await login("superadmin", "SuperSecret123")).token;
    const r = ok(await login("admin", "DefaultAdmin123"));
    A = r.token; schoolA = r.user.school.id;
    assert.strictEqual(r.user.role, "school_admin");
    assert.strictEqual(ok(await call("GET", "/api/subjects", null, A)).length, 8);
  });
  await test("بدون تسجيل دخول = 401، وكلمة مرور خاطئة = 401", async () => {
    assert.strictEqual((await call("GET", "/api/teachers")).status, 401);
    assert.strictEqual((await call("GET", "/api/teachers", null, "bad-token")).status, 401);
    assert.strictEqual((await login("admin", "wrong")).status, 401);
  });
  await test("تحديد محاولات الدخول الفاشلة (قفل بعد 5)", async () => {
    for (let i = 0; i < 5; i++) await login("lockme", "x" + i);
    assert.strictEqual((await login("lockme", "x")).status, 429);
  });

  await test("المدير العام ينشئ مدرسة ثانية مع مديرها", async () => {
    const bad = await call("POST", "/api/super/schools", { name: "ب", admin_username: "a", admin_password: "123" }, SUPER);
    assert.strictEqual(bad.status, 400);
    const s = ok(await call("POST", "/api/super/schools", { name: "مدرسة الأمل", admin_username: "amal_admin", admin_password: "AmalPass123" }, SUPER), 201);
    schoolB = s.id;
    B = ok(await login("amal_admin", "AmalPass123")).token;
    assert.strictEqual(ok(await call("GET", "/api/subjects", null, B)).length, 8);
    assert.strictEqual(ok(await call("GET", "/api/teachers", null, B)).length, 0);
    assert(ok(await call("GET", "/api/super/schools", null, SUPER)).length >= 2);
  });
  await test("مدير مدرسة لا يصل لإدارة المدارس (403)", async () => {
    assert.strictEqual((await call("GET", "/api/super/schools", null, A)).status, 403);
    assert.strictEqual((await call("POST", "/api/super/schools", { name: "x", admin_username: "hacker1", admin_password: "Password123" }, A)).status, 403);
  });
  await test("المدير العام بلا اختيار مدرسة لا يصل لبيانات مدرسة (400)، ومع x-school-id يعمل", async () => {
    assert.strictEqual((await call("GET", "/api/teachers", null, SUPER)).status, 400);
    assert.strictEqual((await call("GET", "/api/teachers", null, SUPER, { "x-school-id": String(schoolB) })).status, 200);
  });

  // ---- بيانات المدرسة A (الافتراضية) ----
  const subjA = ok(await call("GET", "/api/subjects", null, A));
  const SA = Object.fromEntries(subjA.map((s) => [s.name, s.id]));
  await call("POST", "/api/classes/generate", { grade: "الخامس", sections_count: 2 }, A);
  const classesA = ok(await call("GET", "/api/classes", null, A));
  const tA = ok(await call("POST", "/api/teachers", { name: "أحمد", phone: "0770", subject_ids: [SA["عربي"], SA["انكليزي"]] }, A), 201);
  const tA2 = ok(await call("POST", "/api/teachers", { name: "سارة", subject_ids: [SA["رياضيات"]] }, A), 201);
  for (const [n, w] of [["عربي", 5], ["انكليزي", 4], ["رياضيات", 5]]) await call("POST", "/api/class-subjects/bulk-grade", { grade: "الخامس", subject_id: SA[n], weekly_periods: w }, A);
  ok(await call("POST", "/api/teacher-assignments/auto", {}, A));
  ok(await call("POST", "/api/schedule/auto-generate", {}, A));
  const schedA = ok(await call("GET", "/api/schedule", null, A));

  // ---- بيانات المدرسة B ----
  const subjB = ok(await call("GET", "/api/subjects", null, B));
  const SB = Object.fromEntries(subjB.map((s) => [s.name, s.id]));
  await call("POST", "/api/classes/generate", { grade: "الخامس", sections_count: 1 }, B); // نفس اسم الصف "الخامس أ" مسموح بمدرسة أخرى
  const classesB = ok(await call("GET", "/api/classes", null, B));
  const tB = ok(await call("POST", "/api/teachers", { name: "كريم", subject_ids: [SB["عربي"]] }, B), 201);

  await test("نفس اسم الصف/المادة مسموح في مدرستين مختلفتين", async () => {
    assert.strictEqual(classesB[0].name, "الخامس أ");
    assert(classesA.some((c) => c.name === "الخامس أ"));
    assert.notStrictEqual(classesB[0].id, classesA[0].id);
    assert.strictEqual((await call("POST", "/api/subjects", { name: "عربي" }, B)).status, 400); // مكرر داخل نفس المدرسة فقط
    assert.strictEqual((await call("POST", "/api/subjects", { name: "حاسوب" }, A)).status, 201);
    assert.strictEqual((await call("POST", "/api/subjects", { name: "حاسوب" }, B)).status, 201);
  });

  await test("عزل القراءة: B لا يرى شيئاً من A", async () => {
    const names = (rows) => rows.map((r) => r.name);
    assert.deepStrictEqual(names(ok(await call("GET", "/api/teachers", null, B))), ["كريم"]);
    assert(!ok(await call("GET", "/api/teachers", null, B)).some((t) => t.name === "أحمد"));
    assert.strictEqual(ok(await call("GET", "/api/schedule", null, B)).length, 0);
    assert.strictEqual(ok(await call("GET", "/api/class-subjects", null, B)).length, 0);
    assert.strictEqual(ok(await call("GET", "/api/teacher-assignments", null, B)).length, 0);
    assert.strictEqual(ok(await call("GET", "/api/audit-logs", null, B)).every((l) => !String(l.details).includes("أحمد")), true);
    assert.strictEqual(ok(await call("GET", "/api/schedule/validate", null, B)).totalRequired, 0);
    // إعدادات كل مدرسة منفصلة
    await call("PUT", "/api/settings/school-info", { school_name: "مدرسة النور" }, A);
    assert.notStrictEqual(ok(await call("GET", "/api/settings/school-info", null, B)).school_name, "مدرسة النور");
    // أيام/شفتات منفصلة
    await call("PUT", "/api/schedule-config/shift/morning", { start_time: "07:00" }, B);
    assert.strictEqual(ok(await call("GET", "/api/schedule-config", null, A)).shifts.find((s) => s.shift_type === "morning").start_time, "08:00");
  });

  await test("عزل الكتابة: B لا يعدّل/يحذف سجلات A (404)", async () => {
    const aTeacher = tA.id, aClass = classesA[0].id, aRow = schedA[0].id;
    assert.strictEqual((await call("PUT", `/api/teachers/${aTeacher}`, { name: "اختراق" }, B)).status, 404);
    assert.strictEqual((await call("DELETE", `/api/teachers/${aTeacher}`, null, B)).status, 404);
    assert.strictEqual((await call("GET", `/api/teachers/${aTeacher}/schedule`, null, B)).status, 404);
    assert.strictEqual((await call("PUT", `/api/classes/${aClass}`, { custom_periods_per_day: 2 }, B)).status, 404);
    await call("DELETE", `/api/classes/${aClass}`, null, B); // no-op مقيّد بالمدرسة
    await call("DELETE", `/api/subjects/${SA["عربي"]}`, null, B);
    await call("DELETE", `/api/schedule/${aRow}`, null, B);
    await call("DELETE", "/api/schedule", null, B);
    assert.strictEqual((await call("PUT", `/api/schedule/${aRow}`, { period_number: 3 }, B)).status, 404);
    assert.strictEqual((await call("POST", "/api/schedule/swap", { a: aRow, b: schedA[1].id }, B)).status, 404);
    // بعد كل هذا، بيانات A كما هي
    assert.strictEqual(ok(await call("GET", "/api/schedule", null, A)).length, schedA.length);
    assert.strictEqual(ok(await call("GET", "/api/teachers", null, A)).find((t) => t.id === aTeacher).name, "أحمد");
    assert(ok(await call("GET", "/api/classes", null, A)).some((c) => c.id === aClass));
    assert(ok(await call("GET", "/api/subjects", null, A)).some((s) => s.id === SA["عربي"]));
  });

  await test("عزل الإنشاء المتقاطع: لا ربط بمعرفات من مدرسة أخرى", async () => {
    const x = { teacher_id: tA.id, class_id: classesB[0].id, subject_id: SB["عربي"], day_of_week: 0, period_number: 1 };
    assert.strictEqual((await call("POST", "/api/schedule", x, B)).status, 409); // معلم A
    assert.strictEqual((await call("POST", "/api/schedule", { ...x, teacher_id: tB.id, class_id: classesA[0].id }, B)).status, 409); // صف A
    assert.strictEqual((await call("POST", "/api/schedule", { ...x, teacher_id: tB.id, subject_id: SA["عربي"] }, B)).status, 404); // مادة A
    assert.strictEqual((await call("POST", "/api/class-subjects", { class_id: classesA[0].id, subject_id: SB["عربي"], weekly_periods: 3 }, B)).status, 404);
    assert.strictEqual((await call("POST", "/api/class-subjects", { class_id: classesB[0].id, subject_id: SA["عربي"], weekly_periods: 3 }, B)).status, 404);
    assert.strictEqual((await call("POST", "/api/class-subjects/bulk-grade", { grade: "الخامس", subject_id: SA["عربي"], weekly_periods: 3 }, B)).status, 404);
    assert.strictEqual((await call("POST", "/api/teacher-assignments", { teacher_id: tA.id, class_id: classesB[0].id, subject_id: SB["عربي"] }, B)).status, 404);
    assert.strictEqual((await call("POST", "/api/users", { teacher_id: tA.id, username: "steal_a", password: "Password123" }, B)).status, 404);
    // معلم B لا يُربط بمواد A
    const t = ok(await call("POST", "/api/teachers", { name: "تجربة", subject_ids: [SA["عربي"], SB["عربي"]], class_teacher_of: classesA[0].id }, B), 201);
    assert.deepStrictEqual(t.subjects.map((s) => s.id), [SB["عربي"]]);
    assert.strictEqual(t.class_teacher_of, null);
    // x-school-id لا يمنح مستخدم المدرسة صلاحية الانتقال
    assert.strictEqual(ok(await call("GET", "/api/teachers", null, B, { "x-school-id": String(schoolA) })).some((t) => t.name === "أحمد"), false);
  });

  await test("وصول المعلم: جدوله فقط، ولا يصل لأي API إدارة", async () => {
    ok(await call("POST", "/api/users", { teacher_id: tA.id, username: "ahmad", password: "Teacher1234" }, A), 201);
    assert.strictEqual((await call("POST", "/api/users", { teacher_id: tA.id, username: "ahmad2", password: "Teacher1234" }, A)).status, 400); // حساب واحد
    const T = ok(await login("ahmad", "Teacher1234")).token;
    const mine = ok(await call("GET", "/api/me/schedule", null, T));
    assert(mine.rows.length > 0 && mine.rows.every((r) => r.class_name));
    const expected = schedA.filter((s) => s.teacher_id === tA.id).length;
    assert.strictEqual(mine.rows.length, expected);
    for (const u of ["/api/teachers", "/api/schedule", "/api/subjects", "/api/classes", "/api/users", "/api/super/schools", "/api/audit-logs"])
      assert.strictEqual((await call("GET", u, null, T)).status, 403, u);
    assert.strictEqual((await call("DELETE", "/api/schedule", null, T)).status, 403);
    assert.strictEqual((await call("POST", "/api/schedule/approve", {}, T)).status, 403);
    // معلم من B لا يرى جدول A
    ok(await call("POST", "/api/users", { teacher_id: tB.id, username: "karim", password: "Teacher1234" }, B), 201);
    const TB = ok(await login("karim", "Teacher1234")).token;
    assert.strictEqual(ok(await call("GET", "/api/me/schedule", null, TB)).rows.length, 0);
    // مدير المدرسة لا يغيّر حساب معلم مدرسة أخرى
    const uid = ok(await call("GET", "/api/users", null, A)).find((u) => u.username === "ahmad").id;
    assert.strictEqual((await call("PUT", `/api/users/${uid}`, { password: "Hacked12345" }, B)).status, 404);
    assert.strictEqual((await login("ahmad", "Teacher1234")).status, 200);
    // تعطيل حساب المعلم
    await call("PUT", `/api/users/${uid}`, { is_active: false }, A);
    assert.strictEqual((await call("GET", "/api/me/schedule", null, T)).status, 401);
    assert.strictEqual((await login("ahmad", "Teacher1234")).status, 401);
  });

  await test("الروابط العامة: برمز المدرسة فقط وبياناتها فقط", async () => {
    const codes = ok(await call("GET", "/api/super/schools", null, SUPER));
    const cA = codes.find((s) => s.id === schoolA).share_code, cB = codes.find((s) => s.id === schoolB).share_code;
    const pubA = ok(await call("GET", `/api/public/${cA}/schedule`));
    assert.strictEqual(pubA.length, schedA.length);
    assert.strictEqual(ok(await call("GET", `/api/public/${cB}/schedule`)).length, 0);
    // طلب صف A عبر رمز B لا يعيد شيئاً
    assert.strictEqual(ok(await call("GET", `/api/public/${cB}/schedule?class_id=${classesA[0].id}`)).length, 0);
    assert.strictEqual(ok(await call("GET", `/api/public/${cB}/classes`)).every((c) => c.id === classesB[0].id), true);
    assert.strictEqual((await call("GET", "/api/public/nonexistent/schedule")).status, 404);
    assert(!JSON.stringify(ok(await call("GET", `/api/public/${cA}/teachers`))).includes("0770")); // لا هواتف
  });

  await test("إيقاف مدرسة: لا دخول ولا جلسات، والبيانات تبقى", async () => {
    const before = ok(await call("GET", "/api/teachers", null, B)).length;
    ok(await call("PUT", `/api/super/schools/${schoolB}`, { is_active: false }, SUPER));
    assert.strictEqual((await call("GET", "/api/teachers", null, B)).status, 401);
    assert.strictEqual((await login("amal_admin", "AmalPass123")).status, 403);
    const code = ok(await call("GET", "/api/super/schools", null, SUPER)).find((s) => s.id === schoolB).share_code;
    assert.strictEqual((await call("GET", `/api/public/${code}/schedule`)).status, 404);
    // لا تعطيل لمدرسة A بالخطأ
    assert.strictEqual(ok(await call("GET", "/api/teachers", null, A)).length >= 2, true);
    // إعادة التفعيل
    ok(await call("PUT", `/api/super/schools/${schoolB}`, { is_active: true, subscription_status: "active" }, SUPER));
    B = ok(await login("amal_admin", "AmalPass123")).token;
    assert.strictEqual(ok(await call("GET", "/api/teachers", null, B)).length, before);
    // اشتراك معلّق
    ok(await call("PUT", `/api/super/schools/${schoolB}`, { subscription_status: "suspended" }, SUPER));
    assert.strictEqual((await login("amal_admin", "AmalPass123")).status, 403);
    ok(await call("PUT", `/api/super/schools/${schoolB}`, { subscription_status: "active" }, SUPER));
    // إعادة تعيين كلمة مرور مدير المدرسة
    ok(await call("POST", `/api/super/schools/${schoolB}/reset-admin-password`, { password: "NewAmalPass123" }, SUPER));
    assert.strictEqual((await login("amal_admin", "AmalPass123")).status, 401);
    assert.strictEqual((await login("amal_admin", "NewAmalPass123")).status, 200);
  });

  await test("تغيير كلمة المرور وتسجيل الخروج", async () => {
    const t = ok(await login("admin", "DefaultAdmin123")).token;
    assert.strictEqual((await call("POST", "/api/auth/change-password", { old_password: "bad", new_password: "NewPassword123" }, t)).status, 400);
    assert.strictEqual((await call("POST", "/api/auth/change-password", { old_password: "DefaultAdmin123", new_password: "short" }, t)).status, 400);
    ok(await call("POST", "/api/auth/change-password", { old_password: "DefaultAdmin123", new_password: "NewPassword123" }, t));
    assert.strictEqual((await login("admin", "DefaultAdmin123")).status, 401);
    const t2 = ok(await login("admin", "NewPassword123")).token;
    ok(await call("POST", "/api/auth/logout", {}, t2));
    assert.strictEqual((await call("GET", "/api/teachers", null, t2)).status, 401);
  });

  await test("كلمات المرور مخزّنة مشفّرة (scrypt)، والجلسات مجزّأة", async () => {
    assert(db.prepare("SELECT password_hash FROM users").all().every((u) => u.password_hash.startsWith("scrypt$")));
    assert(db.prepare("SELECT token_hash FROM sessions").all().every((s) => /^[0-9a-f]{64}$/.test(s.token_hash)));
  });

  await test("وظائف الجدولة ما زالت تعمل لكل مدرسة (A كاملة 100٪)", async () => {
    const A2 = ok(await login("admin", "NewPassword123")).token;
    const rep = ok(await call("GET", "/api/schedule/validate", null, A2));
    assert.strictEqual(rep.completionPercent, 100);
    ok(await call("POST", "/api/schedule/approve", {}, A2));
    assert.strictEqual((await call("DELETE", "/api/schedule", null, A2)).status, 409);
    // اعتماد A لا يقفل B
    B = ok(await login("amal_admin", "NewAmalPass123")).token;
    assert.strictEqual((await call("POST", "/api/classes/generate", { grade: "السادس", sections_count: 1 }, B)).status, 201);
    ok(await call("POST", "/api/class-subjects/bulk-grade", { grade: "السادس", subject_id: SB["عربي"], weekly_periods: 2 }, B), 201);
    ok(await call("POST", "/api/teacher-assignments/auto", {}, B));
    ok(await call("POST", "/api/schedule/auto-generate", {}, B));
    ok(await call("POST", "/api/schedule/unapprove", {}, A2));
  });

  console.log(failed ? `\nفشل ${failed}` : "\nكل اختبارات العزل والمصادقة نجحت");
  process.exit(failed ? 1 : 0);
})();
