// اختبارات v5: عدد دروس لكل يوم، دروس مثبتة، توزيع متنوع + اقتراحات، تعارض مع حلول
process.env.NODE_PATH = __dirname + "/shim/node_modules";
require("module").Module._initPaths();
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sijil5-")), "school.db");
process.env.SUPER_ADMIN_PASSWORD = "SuperSecret123";
process.env.ADMIN_PASSWORD = "DefaultAdmin123";
const app = require("../src/app");
const call = (m, u, b, t) => app.dispatch(m, u, b, t ? { authorization: "Bearer " + t } : {});
const ok = (r, code = 200) => { assert.strictEqual(r.status, code, `expected ${code} got ${r.status}: ${JSON.stringify(r.body)}`); return r.body; };
let failed = 0;
async function test(n, f) { try { await f(); console.log("✓", n); } catch (e) { failed++; console.error("✗", n, "\n  ", e.message); } }

(async () => {
  const A = ok(await call("POST", "/api/auth/login", { username: "admin", password: "DefaultAdmin123" })).token;
  const subs = Object.fromEntries(ok(await call("GET", "/api/subjects", null, A)).map((s) => [s.name, s.id]));
  await call("POST", "/api/classes/generate", { grade: "الخامس", sections_count: 2 }, A);
  await call("POST", "/api/classes/generate", { grade: "السادس", sections_count: 1 }, A);
  const classes = ok(await call("GET", "/api/classes", null, A));
  const [c1, c2, c3] = classes.map((c) => c.id);
  const mk = async (name, list) => ok(await call("POST", "/api/teachers", { name, subject_ids: list.map((n) => subs[n]) }, A), 201);
  const ahmad = await mk("أحمد", ["عربي"]), sara = await mk("سارة", ["انكليزي"]), ali = await mk("علي", ["رياضيات"]), nour = await mk("نور", ["علوم"]);
  for (const [n, w] of [["عربي", 5], ["انكليزي", 4], ["رياضيات", 5], ["علوم", 3]]) {
    await call("POST", "/api/class-subjects/bulk-grade", { grade: "الخامس", subject_id: subs[n], weekly_periods: w }, A);
    await call("POST", "/api/class-subjects/bulk-grade", { grade: "السادس", subject_id: subs[n], weekly_periods: w }, A);
  }
  ok(await call("POST", "/api/teacher-assignments/auto", {}, A));

  await test("عدد دروس يوم لكل الصفوف: يتغيّر عدد الأعمدة والتوليد يلتزم", async () => {
    const r = ok(await call("PUT", "/api/schedule-config/day-periods", { day_of_week: 0, period_count: 4 }, A));
    assert(r.overrides.some((o) => o.day_of_week === 0 && !o.class_id && o.period_count === 4));
    const dp = ok(await call("GET", "/api/schedule-config/day-periods", null, A));
    assert.strictEqual(dp[0].length, 4); assert.strictEqual(dp[1].length, 6);
    ok(await call("POST", "/api/schedule/auto-generate", {}, A));
    const s = ok(await call("GET", "/api/schedule", null, A));
    assert(s.filter((x) => x.day_of_week === 0).every((x) => x.period_number <= 4));
  });
  await test("عدد دروس لصف واحد فقط في يوم (الأولوية على اليوم العام)", async () => {
    ok(await call("PUT", "/api/schedule-config/day-periods", { day_of_week: 1, class_id: c1, period_count: 3 }, A));
    const cl = ok(await call("GET", "/api/classes", null, A));
    assert.strictEqual(cl.find((c) => c.id === c1).periods_by_day[1], 3);
    assert.strictEqual(cl.find((c) => c.id === c2).periods_by_day[1], 6);
    ok(await call("POST", "/api/schedule/auto-generate", {}, A));
    const s = ok(await call("GET", "/api/schedule", null, A));
    assert(s.filter((x) => x.class_id === c1 && x.day_of_week === 1).every((x) => x.period_number <= 3));
    assert.strictEqual((await call("PUT", "/api/schedule-config/day-periods", { day_of_week: 1, period_count: 99 }, A)).status, 400);
    assert.strictEqual((await call("PUT", "/api/schedule-config/day-periods", { day_of_week: 5, period_count: 3 }, A)).status, 400); // الجمعة عطلة
    // إلغاء التخصيص
    ok(await call("PUT", "/api/schedule-config/day-periods", { day_of_week: 1, class_id: c1, period_count: null }, A));
    assert.strictEqual(ok(await call("GET", "/api/classes", null, A)).find((c) => c.id === c1).periods_by_day[1], 6);
  });

  await test("درس مثبّت: الدرس الأخير يوم الاثنين بمعلم محدد يظهر بالجدول ويبقى بعد إعادة التوليد", async () => {
    const r = ok(await call("POST", "/api/fixed-slots", { class_id: c1, day_of_week: 1, period_number: 0, subject_id: subs["علوم"], teacher_id: nour.id }, A), 201);
    assert(r.id);
    for (let i = 0; i < 3; i++) {
      ok(await call("POST", "/api/schedule/auto-generate", {}, A));
      const s = ok(await call("GET", "/api/schedule", null, A));
      const last = s.find((x) => x.class_id === c1 && x.day_of_week === 1 && x.period_number === 6);
      assert(last && last.subject_id === subs["علوم"] && last.teacher_id === nour.id && last.lock_kind === "rule", `iteration ${i}`);
    }
    // تكرار نفس التثبيت مرفوض
    assert.strictEqual((await call("POST", "/api/fixed-slots", { class_id: c1, day_of_week: 1, period_number: 0, subject_id: subs["علوم"] }, A)).status, 409);
  });
  await test("تثبيت لكل الصفوف بدون معلم محدد: يُوزَّع على المعلمين المرتبطين بدون تعارض", async () => {
    ok(await call("POST", "/api/fixed-slots", { class_id: null, day_of_week: 2, period_number: 0, subject_id: subs["عربي"] }, A), 201);
    const g = ok(await call("POST", "/api/schedule/auto-generate", {}, A));
    const s = ok(await call("GET", "/api/schedule", null, A));
    const lasts = s.filter((x) => x.day_of_week === 2 && x.period_number === 6 && x.subject_id === subs["عربي"]);
    // معلم عربي واحد فقط → صف واحد يأخذ التثبيت، والباقي يظهر تنبيه
    assert.strictEqual(lasts.length, 1);
    assert(g.suggestions.some((x) => x.text.includes("تثبيت")), JSON.stringify(g.suggestions));
  });
  await test("الدرس المثبّت يتبع عدد دروس اليوم (الأخير = 4 يوم الأحد)", async () => {
    ok(await call("POST", "/api/fixed-slots", { class_id: c2, day_of_week: 0, period_number: 0, subject_id: subs["رياضيات"], teacher_id: ali.id }, A), 201);
    ok(await call("POST", "/api/schedule/auto-generate", {}, A));
    const s = ok(await call("GET", "/api/schedule", null, A));
    const x = s.find((r) => r.class_id === c2 && r.day_of_week === 0 && r.period_number === 4);
    assert(x && x.subject_id === subs["رياضيات"] && x.lock_kind === "rule");
  });

  await test("إعادة التوليد تعطي توزيعاً مختلفاً + بدائل + اقتراحات", async () => {
    const before = ok(await call("GET", "/api/schedule", null, A)).map((r) => `${r.class_id}-${r.day_of_week}-${r.period_number}-${r.subject_id}`).sort().join("|");
    const g = ok(await call("POST", "/api/schedule/auto-generate", {}, A));
    const after = ok(await call("GET", "/api/schedule", null, A)).map((r) => `${r.class_id}-${r.day_of_week}-${r.period_number}-${r.subject_id}`).sort().join("|");
    assert.notStrictEqual(before, after, "التوزيع لم يتغيّر");
    assert(g.diffPercent > 0 && g.alternatives.length >= 1 && Array.isArray(g.suggestions) && g.suggestions.length >= 1);
    // تطبيق بديل بالـ seed نفسه يعطي نفس النتيجة
    const alt = g.alternatives[0];
    const g2 = ok(await call("POST", "/api/schedule/auto-generate", { seed: alt.seed }, A));
    assert.strictEqual(g2.score, alt.score); assert.strictEqual(g2.filled, alt.filled);
    // المحتوى ثابت لنفس الـ seed
    const snap1 = ok(await call("GET", "/api/schedule", null, A)).map((r) => `${r.class_id}-${r.day_of_week}-${r.period_number}-${r.subject_id}-${r.teacher_id}`).sort().join("|");
    ok(await call("POST", "/api/schedule/auto-generate", { seed: alt.seed }, A));
    const snap2 = ok(await call("GET", "/api/schedule", null, A)).map((r) => `${r.class_id}-${r.day_of_week}-${r.period_number}-${r.subject_id}-${r.teacher_id}`).sort().join("|");
    assert.strictEqual(snap1, snap2);
  });
  await test("التوليد لا يخرق قواعد الصلابة: لا تعارض معلم/صف، الحصص بحدود عدد الدروس", async () => {
    const s = ok(await call("GET", "/api/schedule", null, A));
    const seenT = new Set(), seenC = new Set();
    s.forEach((r) => { const kt = `${r.teacher_id}-${r.day_of_week}-${r.period_number}`, kc = `${r.class_id}-${r.day_of_week}-${r.period_number}`; assert(!seenT.has(kt) && !seenC.has(kc)); seenT.add(kt); seenC.add(kc); });
    const v = ok(await call("GET", "/api/schedule/validate", null, A));
    assert(!v.issues.some((i) => i.message.includes("خارج")));
  });

  await test("تعارض بتعديل يدوي: 409 مع تفاصيل وحلول (نقل لخانة فارغة / تبديل / معلم بديل)", async () => {
    ok(await call("POST", "/api/schedule/auto-generate", { seed: 12345 }, A));
    const s = ok(await call("GET", "/api/schedule", null, A));
    const x = s.find((r) => r.class_id === c3 && !r.lock_kind);
    const y = s.find((r) => r.class_id === c3 && r.id !== x.id && !(r.day_of_week === x.day_of_week && r.period_number === x.period_number));
    // انقل x إلى خانة y (الصف مشغول) → تعارض صف
    const r = await call("PUT", `/api/schedule/${x.id}`, { day_of_week: y.day_of_week, period_number: y.period_number }, A);
    assert.strictEqual(r.status, 409);
    assert(r.body.error && r.body.conflicts.some((c) => c.type === "class_busy"));
    assert(r.body.suggestions.length >= 1 && r.body.suggestions.every((sg) => sg.apply && sg.apply.method && sg.apply.url));
    // تنفيذ أول اقتراح فعلاً يجب أن ينجح
    const sg = r.body.suggestions[0];
    const done = await call(sg.apply.method, sg.apply.url, sg.apply.body, A);
    assert(done.status === 200 || done.status === 201, `suggestion failed: ${done.status} ${JSON.stringify(done.body)} / ${sg.label}`);
  });
  await test("تعارض معلم: معلم مشغول بصف آخر → اقتراح معلم بديل أو خانة بديلة وتنفيذها ينجح", async () => {
    const s = ok(await call("GET", "/api/schedule", null, A));
    const x = s.find((r) => r.class_id === c1 && r.subject_id === subs["رياضيات"] && !r.lock_kind);
    const other = s.find((r) => r.teacher_id === x.teacher_id && r.class_id !== c1);
    // اجعل c1 يحاول أخذ خانة المعلم المشغولة: نحذف حصة c1 في تلك الخانة إن وُجدت
    const occ = s.find((r) => r.class_id === c1 && r.day_of_week === other.day_of_week && r.period_number === other.period_number);
    if (occ) await call("DELETE", `/api/schedule/${occ.id}`, null, A);
    const r = await call("PUT", `/api/schedule/${x.id}`, { day_of_week: other.day_of_week, period_number: other.period_number }, A);
    assert.strictEqual(r.status, 409); assert(r.body.conflicts.some((c) => c.type === "teacher_busy"));
    assert(r.body.suggestions.some((sg) => sg.kind === "teacher") && r.body.suggestions.some((sg) => sg.kind === "move"));
    const t = r.body.suggestions.find((sg) => sg.kind === "teacher");
    const done = await call(t.apply.method, t.apply.url, t.apply.body, A);
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
  });
  await test("نجاح تعديل مع تنبيه غير مانع (زيادة عن المطلوب)", async () => {
    const s = ok(await call("GET", "/api/schedule", null, A));
    // خانة فارغة لـ c3
    const used = new Set(s.filter((r) => r.class_id === c3).map((r) => `${r.day_of_week}-${r.period_number}`));
    let slot; for (const d of [0, 1, 2]) for (let p = 1; p <= 4; p++) if (!used.has(`${d}-${p}`) && !slot) slot = { d, p };
    if (!slot) return;
    const busy = new Set(s.filter((r) => r.teacher_id === ahmad.id).map((r) => `${r.day_of_week}-${r.period_number}`));
    let tid = [ahmad, sara, ali, nour].find((t) => !s.some((r) => r.teacher_id === t.id && r.day_of_week === slot.d && r.period_number === slot.p)).id;
    const r = ok(await call("POST", "/api/schedule", { teacher_id: tid, class_id: c3, subject_id: subs["عربي"], day_of_week: slot.d, period_number: slot.p }, A), 201);
    assert(Array.isArray(r.warnings) && r.warnings.length >= 1, JSON.stringify(r.warnings));
  });

  await test("حصة مثبّتة يدوياً 📌 تبقى بنفس مكانها بعد إعادة التوليد", async () => {
    ok(await call("POST", "/api/schedule/auto-generate", { seed: 777 }, A));
    const s = ok(await call("GET", "/api/schedule", null, A));
    const x = s.find((r) => r.class_id === c3 && !r.lock_kind);
    ok(await call("POST", `/api/schedule/${x.id}/pin`, { pinned: true }, A));
    for (const seed of [1, 2, 3]) {
      ok(await call("POST", "/api/schedule/auto-generate", { seed }, A));
      const t = ok(await call("GET", "/api/schedule", null, A)).find((r) => r.class_id === x.class_id && r.day_of_week === x.day_of_week && r.period_number === x.period_number);
      assert(t && t.subject_id === x.subject_id && t.teacher_id === x.teacher_id && t.lock_kind === "manual", `seed ${seed}`);
    }
  });
  await test("تطبيق التثبيتات على الجدول الحالي فوراً", async () => {
    const before = ok(await call("GET", "/api/fixed-slots", null, A));
    const r = ok(await call("POST", "/api/fixed-slots/apply", {}, A));
    assert(typeof r.placed === "number");
    ok(await call("DELETE", `/api/fixed-slots/${before[0].id}`, null, A));
    assert.strictEqual(ok(await call("GET", "/api/fixed-slots", null, A)).length, before.length - 1);
  });
  await test("عزل: مدرسة أخرى لا ترى التثبيتات ولا تجاوزات الدروس", async () => {
    const S = ok(await call("POST", "/api/auth/login", { username: "superadmin", password: "SuperSecret123" })).token;
    ok(await call("POST", "/api/super/schools", { name: "الأمل", admin_username: "amal5", admin_password: "AmalPass123" }, S), 201);
    const B = ok(await call("POST", "/api/auth/login", { username: "amal5", password: "AmalPass123" })).token;
    assert.strictEqual(ok(await call("GET", "/api/fixed-slots", null, B)).length, 0);
    assert.strictEqual(ok(await call("GET", "/api/schedule-config", null, B)).overrides.length, 0);
    const dp = ok(await call("GET", "/api/schedule-config/day-periods", null, B));
    assert.strictEqual(dp[0].length, 6);
    assert.strictEqual((await call("DELETE", `/api/fixed-slots/${ok(await call("GET", "/api/fixed-slots", null, A))[0].id}`, null, B)).status, 200); // لا يحذف شيئاً عندها
    assert(ok(await call("GET", "/api/fixed-slots", null, A)).length >= 1);
  });

  console.log(failed ? `\n${failed} اختبار فشل` : "\nكل اختبارات v5 نجحت");
  process.exit(failed ? 1 : 0);
})();
