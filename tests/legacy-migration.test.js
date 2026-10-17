// يختبر ترحيل قواعد بيانات قديمة (v1 الأصلية و v2 قبل تعدد المدارس) إلى النظام الجديد بدون فقدان بيانات
// الاستعمال: node tests/legacy-migration.test.js <old-project-dir> <label>
process.env.NODE_PATH = __dirname + "/shim/node_modules";
require("module").Module._initPaths();
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const [oldDir, label] = [process.argv[2], process.argv[3] || "legacy"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
const file = path.join(tmp, "school.db");

// 1) بناء قاعدة قديمة بكود المشروع القديم نفسه
const Module = require("module");
const oldDb = (() => {
  const orig = Module._resolveFilename;
  const DB = require(path.join(__dirname, "shim/node_modules/better-sqlite3"));
  // نجبر كود القديم على استخدام ملفنا
  const real = DB;
  const Patched = function (p) { return new real(file); };
  const cache = require.cache[require.resolve(path.join(__dirname, "shim/node_modules/better-sqlite3"))];
  const saved = cache.exports; cache.exports = Patched;
  const d = require(path.join(oldDir, "src/db.js"));
  cache.exports = saved;
  return d;
})();
const hasV2 = oldDb.prepare("SELECT name FROM sqlite_master WHERE name='class_subjects'").get();
oldDb.prepare("INSERT INTO teachers (name, phone) VALUES ('معلم قديم','0750')").run();
const sub = oldDb.prepare("SELECT id FROM subjects WHERE name='عربي'").get().id;
oldDb.prepare("INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (1, ?)").run(sub);
oldDb.prepare("INSERT INTO school_classes (name, grade, section, periods_per_day) VALUES ('الأول أ','الأول','أ',6)").run();
oldDb.prepare("INSERT INTO schedule (teacher_id, class_id, subject_id, day_of_week, period_number) VALUES (1,1,?,0,1)").run(sub);
oldDb.prepare("INSERT INTO settings (key,value) VALUES ('school_name','مدرسة قديمة') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
if (hasV2) {
  oldDb.prepare("UPDATE schedule_shifts SET start_time='07:30' WHERE shift_type='morning'").run();
  oldDb.prepare("INSERT INTO class_subjects (class_id, subject_id, weekly_periods, allow_same_day_repeat, max_per_day) VALUES (1,?,4,1,2)").run(sub);
  oldDb.prepare("INSERT INTO teacher_assignments (teacher_id, class_id, subject_id) VALUES (1,1,?)").run(sub);
}
const subjectsBefore = oldDb.prepare("SELECT COUNT(*) n FROM subjects").get().n;
oldDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
for (const k of Object.keys(require.cache)) if (k.includes("/src/") ) delete require.cache[k];

// 2) تشغيل النظام الجديد على نفس الملف
process.env.DB_PATH = file;
process.env.SUPER_ADMIN_PASSWORD = "SuperSecret123";
process.env.ADMIN_PASSWORD = "DefaultAdmin123";
const app = require("../src/app");
const db = require("../src/db");
const call = (m, u, b, t) => app.dispatch(m, u, b, t ? { authorization: "Bearer " + t } : {});

let failed = 0;
async function test(n, f) { try { await f(); console.log("✓", n); } catch (e) { failed++; console.error("✗", n, "\n  ", e.message); } }

(async () => {
  const T = (await call("POST", "/api/auth/login", { username: "admin", password: "DefaultAdmin123" })).body.token;
  await test(`[${label}] البيانات القديمة تصبح تابعة للمدرسة الافتراضية`, async () => {
    const teachers = (await call("GET", "/api/teachers", null, T)).body;
    assert.strictEqual(teachers.length, 1); assert.strictEqual(teachers[0].name, "معلم قديم"); assert.strictEqual(teachers[0].subjects[0].name, "عربي");
    assert.strictEqual((await call("GET", "/api/classes", null, T)).body[0].name, "الأول أ");
    assert.strictEqual((await call("GET", "/api/schedule", null, T)).body.length, 1);
    assert.strictEqual((await call("GET", "/api/subjects", null, T)).body.length, subjectsBefore);
    assert.strictEqual((await call("GET", "/api/settings/school-info", null, T)).body.school_name, "مدرسة قديمة");
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM schools").get().n, 1);
  });
  await test(`[${label}] سلامة المفاتيح الأجنبية بعد إعادة البناء`, async () => {
    assert.deepStrictEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const refs = db.prepare("SELECT sql FROM sqlite_master WHERE name='schedule'").get().sql;
    assert(!refs.includes('_pre_mt'));
  });
  await test(`[${label}] لا DROP: الجداول القديمة محفوظة كنسخة`, async () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert(names.includes("subjects_pre_mt") && names.includes("school_classes_pre_mt"));
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM subjects_pre_mt").get().n, subjectsBefore);
  });
  if (hasV2) await test(`[${label}] إعدادات الشفت وحصص المواد تنتقل`, async () => {
    const cfg = (await call("GET", "/api/schedule-config", null, T)).body;
    assert.strictEqual(cfg.shifts.find((s) => s.shift_type === "morning").start_time, "07:30");
    const cs = (await call("GET", "/api/class-subjects", null, T)).body[0];
    assert.strictEqual(cs.weekly_periods, 4); assert.strictEqual(cs.allow_same_day_repeat, 1);
    assert.strictEqual((await call("GET", "/api/teacher-assignments", null, T)).body.length, 1);
  });
  await test(`[${label}] الإقلاع مرة ثانية آمن (idempotent) ومدرسة ثانية تعمل`, async () => {
    require("../src/migrations/multiTenant").run(db, db.ensureColumn, db.PALETTE);
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM schools").get().n, 1);
    assert.strictEqual((await call("GET", "/api/teachers", null, T)).body.length, 1);
    const S = (await call("POST", "/api/auth/login", { username: "superadmin", password: "SuperSecret123" })).body.token;
    const r = await call("POST", "/api/super/schools", { name: "ثانية", admin_username: "second", admin_password: "Second12345" }, S);
    assert.strictEqual(r.status, 201);
    const T2 = (await call("POST", "/api/auth/login", { username: "second", password: "Second12345" })).body.token;
    assert.strictEqual((await call("GET", "/api/teachers", null, T2)).body.length, 0);
    assert.strictEqual((await call("POST", "/api/classes/generate", { grade: "الأول", sections_count: 1 }, T2)).status, 201);
  });
  console.log(failed ? `\nفشل ${failed}` : "\nالترحيل سليم");
  process.exit(failed ? 1 : 0);
})();
