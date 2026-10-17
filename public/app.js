
function t12p(t) { const [h, m] = String(t).split(":").map(Number); return { t: `${h % 12 || 12}:${String(m).padStart(2, "0")}`, s: h >= 12 ? "م" : "ص" }; }
const isl = (s) => "\u2066" + s + "\u2069"; // عزل اتجاه النص حتى لا ينقلب ترتيب الوقت
function t12(t) { if (!t) return "—"; const p = t12p(t); return `${p.t} ${isl(p.s)}`; }
function rng12(a, b) { if (!a || !b) return ""; const x = t12p(a), y = t12p(b); return isl(x.s === y.s ? `${x.t}–${y.t} ${isl(x.s)}` : `${x.t} ${isl(x.s)}–${y.t} ${isl(y.s)}`); }
const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const emptyRow = (cols) => `<tr><td colspan="${cols}" class="muted-text">لا توجد بيانات بعد</td></tr>`;

// ---------- طبقة الاتصال بالـ API ----------
const store = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
let me = null; // المستخدم الحالي

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = store.get("sijil_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (me && me.role === "super_admin" && store.get("sijil_school")) headers["x-school-id"] = store.get("sijil_school");
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !path.startsWith("/api/auth/login")) { logoutLocal(); throw new Error("انتهت الجلسة"); }
  if (!res.ok) { const err = new Error(data.error || "حدث خطأ غير متوقع"); err.data = data; throw err; }
  return data;
}
const post = (p, b) => apiFetch(p, { method: "POST", body: JSON.stringify(b || {}) });
const put = (p, b) => apiFetch(p, { method: "PUT", body: JSON.stringify(b || {}) });
const del = (p) => apiFetch(p, { method: "DELETE" });

// ---------- تسجيل الدخول والأدوار ----------
$("loginBtn").addEventListener("click", tryLogin);
["pwInput", "userInput"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); }));

async function tryLogin() {
  $("loginError").textContent = "";
  try {
    const r = await post("/api/auth/login", { username: $("userInput").value.trim(), password: $("pwInput").value });
    store.set("sijil_token", r.token); store.set("sijil_school", "");
    $("pwInput").value = "";
    await enter();
  } catch (e) { $("loginError").textContent = e.message; }
}
function logoutLocal() {
  store.set("sijil_token", ""); store.set("sijil_school", ""); me = null;
  $("app").classList.add("hidden"); $("loginScreen").classList.remove("hidden");
}
$("logoutBtn").addEventListener("click", async () => { try { await post("/api/auth/logout"); } catch (e) { /* ignore */ } logoutLocal(); });

async function enter() {
  me = await apiFetch("/api/auth/me");
  $("loginScreen").classList.add("hidden"); $("app").classList.remove("hidden");
  applyRole();
}
(async () => { if (store.get("sijil_token")) { try { await enter(); } catch (e) { logoutLocal(); } } })();

function showView(view) {
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  refreshView(view);
}
function applyRole() {
  const acting = me.role === "super_admin" && store.get("sijil_school");
  const schoolMode = me.role === "school_admin" || acting;
  document.querySelectorAll(".nav-school").forEach((b) => b.classList.toggle("hidden", !schoolMode));
  document.querySelectorAll(".nav-super").forEach((b) => b.classList.toggle("hidden", me.role !== "super_admin"));
  document.querySelectorAll(".nav-teacher").forEach((b) => b.classList.toggle("hidden", me.role !== "teacher"));
  $("topbarTitle").textContent = me.school ? me.school.name : "سِجِلّ — المدير العام";
  $("userBox").innerHTML = `<b>${esc(me.school ? me.school.name : "المدير العام")}</b><span>${esc(me.username)}</span>`;
  const banner = $("actingBanner");
  if (acting) {
    banner.classList.remove("hidden");
    banner.innerHTML = `أنت تدير مدرسة: <b>${esc(store.get("sijil_school_name"))}</b> <button class="btn btn-ghost" id="exitActingBtn">عودة إلى المدارس</button>`;
    $("exitActingBtn").onclick = () => { store.set("sijil_school", ""); store.set("sijil_school_name", ""); applyRole(); };
  } else banner.classList.add("hidden");
  showView(me.role === "super_admin" ? (acting ? "dashboard" : "schools") : me.role === "teacher" ? "mySchedule" : "dashboard");
}

$("changePwBtn").addEventListener("click", () => { $("pwMsg").textContent = ""; $("pwForm").reset(); $("pwModal").classList.remove("hidden"); });
$("pwCancel").addEventListener("click", () => $("pwModal").classList.add("hidden"));
$("pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try { await post("/api/auth/change-password", { old_password: fd.get("old_password"), new_password: fd.get("new_password") }); $("pwModal").classList.add("hidden"); alert("تم تغيير كلمة المرور"); }
  catch (err) { $("pwMsg").textContent = err.message; }
});

// ---------- التنقل ----------
document.querySelectorAll(".nav-link").forEach((btn) => btn.addEventListener("click", () => { showView(btn.dataset.view); closeMenu(); }));
const closeMenu = () => document.body.classList.remove("nav-open");
$("menuBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
$("scrim").addEventListener("click", closeMenu);
function refreshView(v) {
  ({
    dashboard: loadDashboard,
    teachers: () => { loadTeacherForm(); loadTeachers(); },
    subjects: loadSubjects, classes: loadClasses, assignments: loadAssignments,
    shifts: loadShifts, schedule: loadScheduleView, settings: loadSchoolInfo,
    schools: loadSchools, mySchedule: loadMySchedule,
  })[v]?.();
}

// ---------- المدارس (المدير العام) ----------
const SUB_LABEL = { active: "نشط", trial: "تجريبي", suspended: "معلّق", expired: "منتهي" };
async function loadSchools() {
  const rows = await apiFetch("/api/super/schools");
  $("schoolsTable").innerHTML = `<table><thead><tr><th>المدرسة</th><th>مدير المدرسة</th><th>معلمون</th><th>صفوف</th><th>الاشتراك</th><th>الحالة</th><th></th></tr></thead><tbody>${
    rows.map((s) => `<tr><td>${esc(s.name)}</td><td class="mono">${esc(s.admin_username || "—")}</td><td>${s.teachers_count}</td><td>${s.classes_count}</td>
    <td><select onchange="setSubscription(${s.id}, this.value)">${Object.entries(SUB_LABEL).map(([k, v]) => `<option value="${k}" ${s.subscription_status === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
    <td><span class="badge ${s.is_active ? "badge-sent" : "badge-failed"}">${s.is_active ? "مفعّلة" : "موقوفة"}</span></td>
    <td class="nowrap"><button class="btn btn-ghost" onclick="manageSchool(${s.id}, '${esc(s.name).replace(/'/g, "")}')">إدارة</button>
      <button class="btn btn-ghost" onclick="toggleSchool(${s.id}, ${s.is_active ? 0 : 1})">${s.is_active ? "إيقاف" : "تفعيل"}</button>
      <button class="btn btn-ghost" onclick="resetAdminPw(${s.id})">كلمة سر المدير</button></td></tr>`).join("") || emptyRow(7)}</tbody></table>`;
}
$("schoolCreateForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("schoolCreateMsg").textContent = "";
  try { await post("/api/super/schools", Object.fromEntries(new FormData(e.target).entries())); e.target.reset(); loadSchools(); }
  catch (err) { $("schoolCreateMsg").textContent = err.message; }
});
function manageSchool(id, name) { store.set("sijil_school", String(id)); store.set("sijil_school_name", name); applyRole(); }
async function toggleSchool(id, active) {
  if (!active && !confirm("إيقاف المدرسة سيمنع الدخول لكل مستخدميها (البيانات تبقى محفوظة). متأكد؟")) return;
  await put(`/api/super/schools/${id}`, { is_active: !!active }); loadSchools();
}
async function setSubscription(id, status) { await put(`/api/super/schools/${id}`, { subscription_status: status }); loadSchools(); }
async function resetAdminPw(id) {
  const pw = prompt("كلمة المرور الجديدة لمدير المدرسة (8 أحرف على الأقل):");
  if (!pw) return;
  try { await post(`/api/super/schools/${id}/reset-admin-password`, { password: pw }); alert("تم تغيير كلمة المرور"); } catch (e) { alert(e.message); }
}

// ---------- جدول المعلم ----------
async function loadMySchedule() {
  const data = await apiFetch("/api/me/schedule");
  const days = Object.keys(data.day_periods).map(Number).sort((a, b) => a - b);
  const maxP = Math.max(0, ...days.map((d) => data.day_periods[d].length));
  const at = (d, p) => data.rows.find((r) => r.day_of_week === d && r.period_number === p);
  let h = `<table class="timetable"><thead><tr><th></th>${days.map((d) => `<th>${DAY_NAMES[d]}</th>`).join("")}</tr></thead><tbody>`;
  for (let p = 1; p <= maxP; p++) {
    h += `<tr><th class="period-cell">${lessonName(p)}</th>`;
    days.forEach((d) => {
      const pt = data.day_periods[d][p - 1]; const r = at(d, p);
      h += `<td>${pt ? `<div class="cell-time">${rng12(pt.start, pt.end)}</div>` : ""}${r ? `<div class="slot" style="--slot-color:#2F4858"><span class="subj">${esc(r.subject_name)}</span><span class="meta">${esc(r.class_name)}</span></div>` : ""}</td>`;
    });
    h += "</tr>";
  }
  $("myScheduleGrid").innerHTML = data.rows.length ? h + "</tbody></table>" : '<p class="muted-text pad">لا توجد حصص في جدولك بعد.</p>';
}

// ---------- نظرة عامة ----------
async function loadDashboard() {
  const [teachers, classes, subjects, schedule, report, cfg] = await Promise.all([
    apiFetch("/api/teachers"), apiFetch("/api/classes"), apiFetch("/api/subjects"),
    apiFetch("/api/schedule"), apiFetch("/api/schedule/validate"), apiFetch("/api/schedule-config/day-periods"),
  ]);
  $("statGrid").innerHTML = [
    [teachers.length, "معلم/ـة"], [subjects.length, "مادة دراسية"], [classes.length, "صف/شعبة"], [schedule.length, "حصة في الجدول"],
  ].map(([n, l]) => `<div class="stat-card"><div class="num">${n}</div><div class="label">${l}</div></div>`).join("");
  $("dashProgress").innerHTML = `<h3>اكتمال الجدول</h3>
    <div class="progress"><div style="width:${report.completionPercent}%"></div></div>
    <p class="muted-text">${report.totalFilled} من ${report.totalRequired} حصة مطلوبة (${report.completionPercent}%) — الحالة: ${statusLabel(report.status)}</p>`;
  const today = new Date().getDay();
  const rows = schedule.filter((s) => s.day_of_week === today).sort((a, b) => a.period_number - b.period_number || a.class_name.localeCompare(b.class_name));
  $("todaySchedule").innerHTML = `<table><thead><tr><th>الحصة</th><th>الوقت</th><th>المادة</th><th>الصف</th><th>المعلم</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${r.period_number}</td><td class="mono">${t12(r.start_time)}</td><td>${esc(r.subject_name)}</td><td>${esc(r.class_name)}</td><td>${esc(r.teacher_name)}</td></tr>`).join("") || emptyRow(5)}</tbody></table>`;
}
const statusLabel = (s) => (s === "approved" ? "معتمد" : "مسودة");

// ---------- المعلمون ----------
let editingTeacherId = null;
async function loadTeacherForm(checked = [], classTeacherOf = "") {
  const [subjects, classes] = await Promise.all([apiFetch("/api/subjects"), apiFetch("/api/classes")]);
  $("teacherSubjectsCheckboxes").innerHTML = subjects.map((s) => `<label class="checkbox-label"><input type="checkbox" value="${s.id}" ${checked.includes(s.id) ? "checked" : ""}/> ${esc(s.name)}</label>`).join("")
    || '<span class="muted-text">أضف مواد أولاً</span>';
  $("classTeacherSelect").innerHTML = `<option value="">— ليس معلم صف —</option>` + classes.map((c) => `<option value="${c.id}" ${String(c.id) === String(classTeacherOf) ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}
$("teacherForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    name: fd.get("name"), phone: fd.get("phone"), class_teacher_of: fd.get("class_teacher_of") || null,
    subject_ids: [...document.querySelectorAll("#teacherSubjectsCheckboxes input:checked")].map((c) => Number(c.value)),
  };
  if (editingTeacherId) await put(`/api/teachers/${editingTeacherId}`, payload);
  else await post("/api/teachers", payload);
  resetTeacherForm(); loadTeachers();
});
$("teacherCancelEditBtn").addEventListener("click", resetTeacherForm);
function resetTeacherForm() {
  editingTeacherId = null; $("teacherForm").reset();
  $("teacherFormTitle").textContent = "إضافة معلم جديد"; $("teacherSubmitBtn").textContent = "إضافة";
  $("teacherCancelEditBtn").classList.add("hidden"); loadTeacherForm();
}
async function editTeacher(id) {
  const t = (await apiFetch("/api/teachers")).find((x) => x.id === id);
  if (!t) return;
  editingTeacherId = id;
  $("teacherForm").name.value = t.name; $("teacherForm").phone.value = t.phone || "";
  await loadTeacherForm(t.subjects.map((s) => s.id), t.class_teacher_of || "");
  $("teacherFormTitle").textContent = `تعديل: ${t.name}`; $("teacherSubmitBtn").textContent = "حفظ التعديل";
  $("teacherCancelEditBtn").classList.remove("hidden"); $("teacherForm").scrollIntoView({ behavior: "smooth" });
}
async function loadTeachers() {
  const [teachers, classes] = await Promise.all([apiFetch("/api/teachers"), apiFetch("/api/classes")]);
  const cname = Object.fromEntries(classes.map((c) => [c.id, c.name]));
  $("teachersTable").innerHTML = `<table><thead><tr><th>الاسم</th><th>المواد</th><th>معلم صف</th><th>الهاتف</th><th>حساب الدخول</th><th></th></tr></thead><tbody>${
    teachers.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.subjects.map((s) => esc(s.name)).join("، ") || "—"}</td><td>${esc(cname[t.class_teacher_of] || "—")}</td><td>${esc(t.phone || "—")}</td>
    <td>${t.account_username ? `<span class="mono">${esc(t.account_username)}</span> <button class="btn btn-ghost" onclick="resetTeacherPw(${t.id})">كلمة سر</button>` : `<button class="btn btn-ghost" onclick="createTeacherAccount(${t.id})">إنشاء حساب</button>`}</td>
    <td><button class="btn btn-ghost" onclick="editTeacher(${t.id})">تعديل</button> <button class="btn btn-danger" onclick="deleteTeacher(${t.id})">حذف</button></td></tr>`).join("") || emptyRow(6)}</tbody></table>`;
}
async function createTeacherAccount(id) {
  const username = prompt("اسم المستخدم للمعلم (إنكليزي/أرقام، 3 أحرف+):"); if (!username) return;
  const password = prompt("كلمة المرور (8 أحرف على الأقل):"); if (!password) return;
  try { await post("/api/users", { teacher_id: id, username, password }); loadTeachers(); } catch (e) { alert(e.message); }
}
async function resetTeacherPw(teacherId) {
  const users = await apiFetch("/api/users"); const u = users.find((x) => x.teacher_id === teacherId); if (!u) return;
  const password = prompt("كلمة المرور الجديدة (8 أحرف على الأقل):"); if (!password) return;
  try { await put(`/api/users/${u.id}`, { password }); alert("تم التغيير"); } catch (e) { alert(e.message); }
}
async function deleteTeacher(id) {
  if (!confirm("حذف هذا المعلم؟ سينحذف من جدوله أيضاً.")) return;
  if (editingTeacherId === id) resetTeacherForm();
  await del(`/api/teachers/${id}`); loadTeachers();
}

// ---------- المواد ----------
$("subjectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await post("/api/subjects", { name: new FormData(e.target).get("name") }); e.target.reset(); } catch (err) { alert(err.message); }
  loadSubjects();
});
async function loadSubjects() {
  const subjects = await apiFetch("/api/subjects");
  $("subjectsTable").innerHTML = `<table><tbody>${subjects.map((s) => `<tr><td><span class="color-dot" style="background:${esc(s.color)}"></span> ${esc(s.name)}</td>
    <td><button class="btn btn-danger" onclick="deleteSubject(${s.id})">حذف</button></td></tr>`).join("") || emptyRow(2)}</tbody></table>`;
}
async function deleteSubject(id) {
  if (!confirm("حذف المادة؟ ستنحذف من توزيع المواد والجدول.")) return;
  await del(`/api/subjects/${id}`); loadSubjects();
}

// ---------- الصفوف والشعب ----------
$("classGenForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = Object.fromEntries(new FormData(e.target).entries());
  p.sections_count = Number(p.sections_count);
  p.periods_per_day = p.periods_per_day ? Number(p.periods_per_day) : null;
  $("classGenError").textContent = "";
  try {
    const r = await post("/api/classes/generate", p);
    if (r.skipped?.length) $("classGenError").textContent = `تم التوليد، لكن هذي الشعب موجودة أصلاً: ${r.skipped.join("، ")}`;
    e.target.reset(); loadClasses();
  } catch (err) { $("classGenError").textContent = err.message; }
});
async function loadClasses() {
  const classes = await apiFetch("/api/classes");
  $("classesTable").innerHTML = `<table><thead><tr><th>الصف</th><th>المرحلة</th><th>الشعبة</th><th>حصص/يوم (استثناء)</th><th></th></tr></thead><tbody>${
    classes.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.grade)}</td><td>${esc(c.section)}</td>
    <td><input type="number" min="1" max="12" style="width:80px" placeholder="حسب الدوام" value="${c.custom_periods_per_day || ""}" onchange="setClassPeriods(${c.id}, this.value)" /></td>
    <td><button class="btn btn-danger" onclick="deleteClass(${c.id})">حذف</button></td></tr>`).join("") || emptyRow(5)}</tbody></table>`;
}
async function setClassPeriods(id, v) { try { await put(`/api/classes/${id}`, { custom_periods_per_day: v || null }); } catch (e) { alert(e.message); loadClasses(); } }
async function deleteClass(id) { if (!confirm("حذف الصف؟")) return; await del(`/api/classes/${id}`); loadClasses(); }

// ---------- توزيع المواد ----------
let _classes = [], _subjects = [], _teachers = [];
async function loadLookups() {
  [_classes, _subjects, _teachers] = await Promise.all([apiFetch("/api/classes"), apiFetch("/api/subjects"), apiFetch("/api/teachers")]);
}
const opts = (items, label, sel) => items.map((i) => `<option value="${i.id}" ${String(i.id) === String(sel) ? "selected" : ""}>${esc(label(i))}</option>`).join("");

async function loadAssignments() {
  await loadLookups();
  const grades = [...new Set(_classes.map((c) => c.grade))];
  $("csTarget").innerHTML = grades.map((g) => `<option value="grade:${esc(g)}">كل شعب ${esc(g)}</option>`).join("")
    + _classes.map((c) => `<option value="class:${c.id}">${esc(c.name)} فقط</option>`).join("");
  $("csSubject").innerHTML = opts(_subjects, (s) => s.name);
  const f = $("csFilterClass"); const keep = f.value;
  f.innerHTML = `<option value="">كل الصفوف</option>` + opts(_classes, (c) => c.name, keep);
  const af = $("assignForm");
  af.teacher_id.innerHTML = opts(_teachers, (t) => t.name);
  af.class_id.innerHTML = opts(_classes, (c) => c.name);
  af.subject_id.innerHTML = opts(_subjects, (s) => s.name);
  renderClassSubjects(); renderAssignTable();
}
$("csRepeat").addEventListener("change", (e) => $("csMaxWrap").classList.toggle("hidden", !e.target.checked));
$("csFilterClass").addEventListener("change", renderClassSubjects);

$("classSubjectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const [kind, val] = fd.get("target").split(":");
  const body = {
    subject_id: Number(fd.get("subject_id")), weekly_periods: Number(fd.get("weekly_periods")),
    allow_same_day_repeat: $("csRepeat").checked, max_per_day: Number(fd.get("max_per_day") || 2),
  };
  $("csError").textContent = "";
  try {
    if (kind === "grade") await post("/api/class-subjects/bulk-grade", { ...body, grade: val });
    else await post("/api/class-subjects", { ...body, class_id: Number(val) });
    renderClassSubjects();
  } catch (err) { $("csError").textContent = err.message; }
});

async function renderClassSubjects() {
  const cid = $("csFilterClass").value;
  const rows = await apiFetch("/api/class-subjects" + (cid ? `?class_id=${cid}` : ""));
  const byClass = {};
  rows.forEach((r) => (byClass[r.class_name] = byClass[r.class_name] || []).push(r));
  const html = Object.entries(byClass).map(([cn, list]) => {
    const total = list.reduce((a, r) => a + r.weekly_periods, 0);
    return `<h4 class="group-title">${esc(cn)} <span class="muted-text">— المجموع ${total} حصة/أسبوع</span></h4>
    <table><thead><tr><th>المادة</th><th>حصص/أسبوع</th><th>تكرار بنفس اليوم</th><th></th></tr></thead><tbody>${list.map((r) => `<tr>
      <td><span class="color-dot" style="background:${esc(r.subject_color)}"></span> ${esc(r.subject_name)}</td>
      <td><input type="number" min="0" max="30" style="width:70px" value="${r.weekly_periods}" onchange="updateCS(${r.id}, {weekly_periods: this.value})" /></td>
      <td>${r.allow_same_day_repeat ? `<span class="badge badge-sent">مسموح (حتى ${r.max_per_day}/يوم)</span>` : '<span class="badge badge-pending">غير مسموح</span>'}
        <button class="btn btn-ghost" onclick="toggleRepeat(${r.id}, ${r.allow_same_day_repeat})">${r.allow_same_day_repeat ? "إيقاف" : "تفعيل"}</button></td>
      <td><button class="btn btn-danger" onclick="removeCS(${r.id})">حذف</button></td></tr>`).join("")}</tbody></table>`;
  }).join("");
  $("classSubjectsTable").innerHTML = html || '<p class="muted-text">لم تُحدَّد مواد للصفوف بعد — استخدم النموذج أعلاه.</p>';
}
async function updateCS(id, patch) { try { await put(`/api/class-subjects/${id}`, patch); } catch (e) { alert(e.message); } renderClassSubjects(); }
async function toggleRepeat(id, cur) { await updateCS(id, cur ? { allow_same_day_repeat: false } : { allow_same_day_repeat: true, max_per_day: 2 }); }
async function removeCS(id) { await del(`/api/class-subjects/${id}`); renderClassSubjects(); }

$("assignForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target); $("assignError").textContent = "";
  try { await post("/api/teacher-assignments", { teacher_id: +fd.get("teacher_id"), class_id: +fd.get("class_id"), subject_id: +fd.get("subject_id") }); renderAssignTable(); }
  catch (err) { $("assignError").textContent = err.message; }
});
$("autoAssignBtn").addEventListener("click", async () => {
  const r = await post("/api/teacher-assignments/auto");
  $("assignError").textContent = r.unassigned.length ? `تم إسناد ${r.assigned}. بقي ${r.unassigned.length} بلا معلم مؤهل — أضف المادة لأحد المعلمين.` : `تم إسناد ${r.assigned} مادة تلقائياً ✅`;
  renderAssignTable();
});
async function renderAssignTable() {
  const rows = await apiFetch("/api/teacher-assignments");
  $("assignTable").innerHTML = `<table><thead><tr><th>الصف</th><th>المادة</th><th>المعلم</th><th></th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.class_name)}</td><td>${esc(r.subject_name)}</td><td>${esc(r.teacher_name)}</td><td><button class="btn btn-danger" onclick="removeAssign(${r.id})">حذف</button></td></tr>`).join("") || emptyRow(4)}</tbody></table>`;
}
async function removeAssign(id) { await del(`/api/teacher-assignments/${id}`); renderAssignTable(); }

// ---------- إعدادات الدوام ----------
async function loadShifts() {
  const cfg = await apiFetch("/api/schedule-config");
  $("shiftCards").innerHTML = cfg.shifts.map((s) => `<div class="card" data-shift="${s.shift_type}">
    <h3>الدوام ${esc(s.label)}</h3>
    <div class="form-col">
      <label class="field-label">وقت بداية الحصة الأولى</label><input type="time" name="start_time" value="${s.start_time}" />
      <label class="field-label">عدد الحصص اليومي</label><input type="number" name="period_count" min="1" max="12" value="${s.period_count}" />
      <label class="field-label">مدة الحصة (دقيقة)</label><input type="number" name="period_minutes" min="10" max="120" value="${s.period_minutes}" />
      <label class="field-label">الاستراحة بعد كل درس (دقيقة) — حدّد كل استراحة لوحدها</label>
      <div class="break-grid">${Array.from({ length: Math.max(0, s.period_count - 1) }, (_, i) => `<label class="break-cell"><span>بعد ${lessonName(i + 1)}</span><input type="number" name="break_${i + 1}" min="0" max="60" value="${(s.breaks && s.breaks[i] != null) ? s.breaks[i] : s.break_minutes}" /></label>`).join("") || '<p class="muted-text">درس واحد فقط — لا توجد استراحات.</p>'}</div>
      <div class="form-row break-all"><input type="number" class="break-all-input" min="0" max="60" placeholder="دقائق" style="width:90px" /><button class="btn btn-ghost" type="button" onclick="fillBreaks('${s.shift_type}')">تعيين الكل بنفس القيمة</button></div>
      <button class="btn btn-accent" onclick="saveShift('${s.shift_type}')">حفظ</button>
      <p class="muted-text shift-msg"></p>
    </div>
    <div class="shift-preview">${cfg.preview[s.shift_type].map((p) => `<div><span class="period-tab sm">${p.period}</span><span class="mono">${rng12(p.start, p.end)}</span>${p.break_after ? `<small class="brk">استراحة ${p.break_after} د</small>` : ""}</div>`).join("")}</div>
  </div>`).join("");
  const map = Object.fromEntries(cfg.dayConfig.map((d) => [d.day_of_week, d.shift_type]));
  $("dayShiftGrid").innerHTML = DAY_NAMES.map((n, i) => `<label class="day-cell"><span>${n}</span>
    <select data-day="${i}"><option value="">عطلة</option>${cfg.shifts.map((s) => `<option value="${s.shift_type}" ${map[i] === s.shift_type ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>`).join("");
  await renderDayPeriods(cfg);
}

// ---------- عدد الدروس لكل يوم ----------
async function renderDayPeriods(cfg) {
  await loadLookups();
  const shiftCount = Object.fromEntries(cfg.shifts.map((x) => [x.shift_type, x.period_count]));
  const work = cfg.dayConfig.filter((d) => d.shift_type);
  const allOv = Object.fromEntries(cfg.overrides.filter((o) => !o.class_id).map((o) => [o.day_of_week, o.period_count]));
  $("dayPeriodsGrid").innerHTML = work.length ? work.map((d) => `<label class="day-cell"><span>${DAY_NAMES[d.day_of_week]}</span>
    <input type="number" min="1" max="12" value="${allOv[d.day_of_week] ?? ""}" placeholder="${shiftCount[d.shift_type]}" onchange="saveDayPeriods(${d.day_of_week}, null, this.value)" /></label>`).join("")
    : '<p class="muted-text">حدّد أيام الدوام أولاً ثم احفظها.</p>';
  $("ovClass").innerHTML = opts(_classes, (c) => c.name);
  $("ovDay").innerHTML = work.map((d) => `<option value="${d.day_of_week}">${DAY_NAMES[d.day_of_week]}</option>`).join("");
  const rows = cfg.overrides.filter((o) => o.class_id);
  $("overrideList").innerHTML = rows.length ? `<table><thead><tr><th>الصف</th><th>اليوم</th><th>عدد الدروس</th><th></th></tr></thead><tbody>${
    rows.map((o) => `<tr><td>${esc(o.class_name)}</td><td>${DAY_NAMES[o.day_of_week]}</td><td>${o.period_count}</td><td><button class="btn btn-danger" onclick="saveDayPeriods(${o.day_of_week}, ${o.class_id}, '')">إلغاء</button></td></tr>`).join("")}</tbody></table>` : "";
}
async function saveDayPeriods(day, classId, value) {
  try {
    const r = await put("/api/schedule-config/day-periods", { day_of_week: day, class_id: classId, period_count: value === "" ? null : Number(value) });
    $("dayPeriodsResult").textContent = r.outside ? `تم الحفظ — ${r.outside} حصة صارت خارج عدد الدروس الجديد، أعد توليد الجدول أو انقلها.` : "تم الحفظ ✅";
    await renderDayPeriods(r);
  } catch (e) { $("dayPeriodsResult").textContent = e.message; }
}
$("ovAddBtn").addEventListener("click", () => {
  const v = $("ovCount").value;
  if (!v) { $("dayPeriodsResult").textContent = "اكتب عدد الدروس"; return; }
  saveDayPeriods(Number($("ovDay").value), Number($("ovClass").value), v);
});
function fillBreaks(type) {
  const card = document.querySelector(`[data-shift="${type}"]`);
  const v = card.querySelector(".break-all-input").value;
  if (v === "") return;
  card.querySelectorAll('[name^="break_"]').forEach((el) => (el.value = v));
}
async function saveShift(type) {
  const card = document.querySelector(`[data-shift="${type}"]`);
  const g = (n) => card.querySelector(`[name=${n}]`).value;
  try {
    const n = +g("period_count");
    const breaks = Array.from({ length: Math.max(0, n - 1) }, (_, i) => { const el = card.querySelector(`[name=break_${i + 1}]`); return el ? +el.value : 5; });
    await put(`/api/schedule-config/shift/${type}`, { start_time: g("start_time"), period_count: n, period_minutes: +g("period_minutes"), break_minutes: breaks.length ? breaks[0] : 5, breaks });
    await loadShifts();
    document.querySelector(`[data-shift="${type}"] .shift-msg`).textContent = "تم الحفظ وتحديث الأوقات ✅";
  } catch (e) { card.querySelector(".shift-msg").textContent = e.message; }
}
$("saveDaysBtn").addEventListener("click", async () => {
  const days = {};
  document.querySelectorAll("#dayShiftGrid select").forEach((s) => (days[s.dataset.day] = s.value || null));
  try { await put("/api/schedule-config/days", { days }); $("daysResult").textContent = "تم الحفظ ✅"; } catch (e) { $("daysResult").textContent = e.message; }
});

// ---------- الجدول الدراسي ----------
const ORD = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];
const lessonName = (n) => `الدرس ${ORD[n - 1] || n}`;
const isMobile = () => window.matchMedia("(max-width: 820px)").matches;
let _dayShift = {}, mobileDay = null;
async function getShareCode() {
  if (me.school) return me.school.share_code;
  const s = (await apiFetch("/api/super/schools")).find((x) => String(x.id) === store.get("sijil_school"));
  return s ? s.share_code : "";
}
let _status = "draft", _dayPeriods = {}, _schedule = [];

async function loadScheduleView() {
  await loadLookups();
  _shareCode = await getShareCode();
  const f = $("scheduleForm");
  f.class_id.innerHTML = opts(_classes, (c) => c.name);
  f.subject_id.innerHTML = opts(_subjects, (s) => s.name);
  f.teacher_id.innerHTML = opts(_teachers, (t) => t.name);
  f.day_of_week.innerHTML = DAY_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join("");
  fillFilterValues();
  await refreshSchedule();
  await fillFixedForm();
}
function fillFilterValues() {
  const type = $("scheduleFilterType").value, sel = $("scheduleFilterValue"), day = $("scheduleDayFilter");
  const keep = sel.value, keepDay = day.value;
  sel.classList.toggle("hidden", type === "all"); day.classList.toggle("hidden", type !== "all");
  if (type !== "all") sel.innerHTML = type === "class" ? opts(_classes, (c) => c.name, keep) : opts(_teachers, (t) => t.name, keep);
  const days = Object.keys(_dayPeriods).map(Number).sort((x, y) => x - y);
  day.innerHTML = `<option value="week">الأسبوع كاملاً (جدول لكل صف)</option>` + days.map((d) => `<option value="${d}" ${String(d) === keepDay ? "selected" : ""}>يوم ${DAY_NAMES[d]} (كل الصفوف)</option>`).join("");
  if (keepDay) day.value = keepDay;
}
$("scheduleFilterType").addEventListener("change", () => { fillFilterValues(); renderGrid(); });
$("scheduleFilterValue").addEventListener("change", renderGrid);
$("scheduleDayFilter").addEventListener("change", renderGrid);
let _wasMobile = null;
window.addEventListener("resize", () => { const m = isMobile(); if (m !== _wasMobile) { _wasMobile = m; if ($("view-schedule").classList.contains("active")) renderGrid(); } });

async function refreshSchedule() {
  const [sched, report, dp, cfg] = await Promise.all([apiFetch("/api/schedule"), apiFetch("/api/schedule/validate"), apiFetch("/api/schedule-config/day-periods"), apiFetch("/api/schedule-config")]);
  _schedule = sched; _dayPeriods = dp; _status = report.status;
  const lbl = Object.fromEntries(cfg.shifts.map((s) => [s.shift_type, s.label]));
  _dayShift = Object.fromEntries(cfg.dayConfig.map((d) => [d.day_of_week, lbl[d.shift_type] || ""]));
  fillFilterValues();
  const b = $("statusBadge"); b.textContent = statusLabel(_status); b.className = `status-badge ${_status}`;
  $("approveBtn").classList.toggle("hidden", _status === "approved");
  $("unapproveBtn").classList.toggle("hidden", _status !== "approved");
  $("autoGenBtn").disabled = _status === "approved";
  $("manualCard").classList.toggle("hidden", _status === "approved");
  $("fixedCard").classList.toggle("hidden", _status === "approved");
  renderReport(report); renderGrid();
}
function renderReport(r) {
  const errs = r.issues.filter((i) => i.level === "error"), warns = r.issues.filter((i) => i.level === "warn");
  $("validationReport").innerHTML = `
    <div class="report-grid">
      <div class="rep"><b>${r.completionPercent}%</b><span>اكتمال الجدول</span></div>
      <div class="rep"><b>${r.totalRequired}</b><span>حصص مطلوبة</span></div>
      <div class="rep"><b>${r.totalFilled}</b><span>حصص مجدولة</span></div>
      <div class="rep ${r.missing ? "bad" : ""}"><b>${r.missing}</b><span>حصص ناقصة</span></div>
      <div class="rep"><b>${r.conflicts}</b><span>تعارضات</span></div>
    </div>
    <div class="progress"><div style="width:${r.completionPercent}%"></div></div>
    ${r.issues.length ? `<details ${errs.length ? "open" : ""}><summary>المشاكل (${errs.length} أخطاء، ${warns.length} تنبيهات)</summary><ul class="issue-list">${
      r.issues.map((i) => `<li class="${i.level}">${esc(i.message)}</li>`).join("")}</ul></details>` : '<p class="muted-text">لا توجد مشاكل ✅</p>'}`;
}

function toast(msg, ms = 6000) {
  const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
const SUG_ICON = { error: "❌", warn: "⚠️", ok: "✅" };
function renderGenPanel(r) {
  const alts = (r.alternatives || []).map((a) => `<div class="alt-card"><div><b>توزيع بديل</b><small>الدرجة ${a.score}/100 · ${a.unfilled ? `${a.unfilled} ناقصة` : "مكتمل"} · يختلف ${a.diffPercent}% عن الحالي</small></div>
    <button class="btn btn-ghost" onclick="applySeed(${a.seed})">تطبيق</button></div>`).join("");
  const sug = (r.suggestions || []).map((x) => `<li class="${x.level}">${SUG_ICON[x.level] || "💡"} ${esc(x.text)}</li>`).join("");
  $("genPanel").innerHTML = (alts ? `<h4>بدائل جاهزة</h4><div class="alt-list">${alts}</div>` : "") + (sug ? `<h4>اقتراحات</h4><ul class="sug-list">${sug}</ul>` : "");
}
async function runGenerate(seed) {
  $("autoGenResult").textContent = "جاري التوليد...";
  try {
    const r = await post("/api/schedule/auto-generate", seed ? { seed } : {});
    $("autoGenResult").textContent = `تم جدولة ${r.filled} من ${r.required} حصة — الدرجة ${r.score}/100` + (r.unfilled ? ` — بقي ${r.unfilled} ناقصة` : " ✅")
      + (r.diffPercent < 100 ? ` — اختلف ${r.diffPercent}% عن الجدول السابق` : "") + (r.keptManual ? ` — حُفظت ${r.keptManual} حصة مثبّتة 📌` : "");
    renderGenPanel(r);
    refreshSchedule(); loadFixed();
  } catch (e) { $("autoGenResult").textContent = `خطأ: ${e.message}`; }
}
function applySeed(seed) { runGenerate(seed); }
$("autoGenBtn").addEventListener("click", async () => {
  if (_schedule.length && !confirm("سيُنشأ توزيع جديد ويستبدل الجدول الحالي. الحصص والدروس المثبّتة 📌 تبقى كما هي. متأكد؟")) return;
  runGenerate();
});
$("approveBtn").addEventListener("click", async () => {
  if (!confirm("اعتماد الجدول سيقفل التعديل عليه. متأكد؟")) return;
  await post("/api/schedule/approve"); refreshSchedule();
});
$("unapproveBtn").addEventListener("click", async () => { await post("/api/schedule/unapprove"); refreshSchedule(); });

$("scheduleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target); $("scheduleError").textContent = "";
  try {
    const r = await post("/api/schedule", { teacher_id: +fd.get("teacher_id"), class_id: +fd.get("class_id"), subject_id: +fd.get("subject_id"), day_of_week: +fd.get("day_of_week"), period_number: +fd.get("period_number") });
    if (r.warnings && r.warnings.length) toast(r.warnings.join(" · "));
    refreshSchedule();
  } catch (err) { if (err.data && err.data.suggestions) showConflict(err); else $("scheduleError").textContent = err.message; }
});

// ---------- نافذة التعارض + الحلول المقترحة ----------
let _sugg = [];
function showConflict(err) {
  const d = err.data || {};
  _sugg = d.suggestions || [];
  $("conflictBody").innerHTML = `${(d.conflicts || []).length ? `<ul class="issue-list">${d.conflicts.map((c) => `<li class="error">${esc(c.message)}</li>`).join("")}</ul>` : `<p class="conflict-msg">${esc(err.message)}</p>`}
    ${_sugg.length ? `<h4>حلول مقترحة (${_sugg.length}) — اضغط لتطبيق الحل</h4><div class="sug-btns">${_sugg.map((x, i) => `<button class="btn suggest-btn kind-${x.kind}" onclick="applySuggestion(${i})">${{ swap: "🔁", teacher: "👤", replace: "♻️", chain: "🧩", move: "➡️" }[x.kind] || "➡️"} ${esc(x.label)}</button>`).join("")}</div>`
      : '<p class="muted-text">لا توجد حلول تلقائية — جرّب خانة أخرى أو معلماً آخر.</p>'}
    <p id="conflictErr" class="error-text"></p>`;
  $("slotModal").classList.add("hidden");
  $("conflictModal").classList.remove("hidden");
}
async function applySuggestion(i) {
  const x = _sugg[i]; if (!x) return;
  try {
    const r = await apiFetch(x.apply.url, { method: x.apply.method, body: JSON.stringify(x.apply.body) });
    $("conflictModal").classList.add("hidden");
    if (r && r.warnings && r.warnings.length) toast(r.warnings.join(" · ")); else toast("تم تطبيق الحل ✅", 3000);
    refreshSchedule();
  } catch (err) { $("conflictErr").textContent = err.message; }
}
$("conflictClose").addEventListener("click", () => $("conflictModal").classList.add("hidden"));

// ---------- الدروس المثبتة ----------
async function fillFixedForm() {
  const f = $("fixedForm");
  f.class_id.innerHTML = `<option value="">كل الصفوف</option>` + opts(_classes, (c) => c.name);
  f.day_of_week.innerHTML = workDays().map((d) => `<option value="${d}">${DAY_NAMES[d]}</option>`).join("");
  f.period_number.innerHTML = `<option value="0">الدرس الأخير</option>` + Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${lessonName(i + 1)}</option>`).join("");
  f.subject_id.innerHTML = opts(_subjects, (x) => x.name);
  f.teacher_id.innerHTML = `<option value="">أي معلم مرتبط بالمادة</option>` + opts(_teachers, (x) => x.name);
  await loadFixed();
}
async function loadFixed() {
  const rows = await apiFetch("/api/fixed-slots");
  $("fixedList").innerHTML = rows.length ? `<table><thead><tr><th>الصف</th><th>اليوم</th><th>الدرس</th><th>المادة</th><th>المعلم</th><th></th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.class_name || "كل الصفوف")}</td><td>${DAY_NAMES[r.day_of_week]}</td><td>${r.period_number ? lessonName(r.period_number) : "الدرس الأخير"}</td><td>${esc(r.subject_name)}</td><td>${esc(r.teacher_name || "أي معلم مرتبط")}</td><td><button class="btn btn-danger" onclick="removeFixed(${r.id})">حذف</button></td></tr>`).join("")}</tbody></table>`
    : '<p class="muted-text">لا توجد دروس مثبتة.</p>';
}
async function removeFixed(id) { await del(`/api/fixed-slots/${id}`); await loadFixed(); refreshSchedule(); }
$("fixedForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const r = await post("/api/fixed-slots", { class_id: fd.get("class_id") || null, day_of_week: +fd.get("day_of_week"), period_number: +fd.get("period_number"), subject_id: +fd.get("subject_id"), teacher_id: fd.get("teacher_id") || null });
    $("fixedMsg").textContent = r.warning || "تمت الإضافة — يُطبَّق عند التوليد، أو اضغط «تطبيق التثبيتات على الجدول الحالي».";
    await loadFixed();
  } catch (err) { $("fixedMsg").textContent = err.message; }
});
$("fixedApplyBtn").addEventListener("click", async () => {
  if (_status === "approved") { $("fixedMsg").textContent = "الجدول معتمد — افتح التعديل أولاً"; return; }
  if (!confirm("سيُوضع كل درس مثبّت بخانته، وقد يستبدل حصة موجودة هناك. متأكد؟")) return;
  try {
    const r = await post("/api/fixed-slots/apply");
    $("fixedMsg").textContent = `وُضع ${r.placed} درس${r.replaced ? `، واستُبدلت ${r.replaced} حصة (أعد التوليد لتعويضها)` : ""}.` + (r.skipped.length ? ` تعذّر: ${r.skipped.join("؛ ")}` : "");
    refreshSchedule();
  } catch (err) { $("fixedMsg").textContent = err.message; }
});

function currentFilter() { return { type: $("scheduleFilterType").value, value: $("scheduleFilterValue").value }; }

// عدد دروس صف في يوم (يراعي التخصيصات)، وإلا عدد أعمدة اليوم
const clsPeriods = (cls, d) => (cls && cls.periods_by_day && cls.periods_by_day[d] != null ? cls.periods_by_day[d] : (_dayPeriods[d] || []).length);
const workDays = () => Object.keys(_dayPeriods).map(Number).sort((x, y) => x - y);

function slotHtml(s, perspective, editable, day, period) {
  const meta = perspective === "teacher" ? s.class_name : s.teacher_name;
  const handlers = editable ? `draggable="true" ondragstart="dragSlot(event, ${s.id})" onclick="openSlot(${day}, ${period}, ${s.id})"` : "";
  return `<div class="slot" ${handlers} style="--slot-color:${esc(s.subject_color || "#2F4858")}">${s.lock_kind ? `<span class="pin" title="${s.lock_kind === "manual" ? "مثبّتة — لا تتغيّر عند إعادة التوليد" : "مثبّتة بقاعدة"}">📌</span>` : ""}<span class="s-txt"><span class="subj">${esc(s.subject_name)}</span><span class="meta">${esc(meta)}</span></span><span class="s-ico">${TT.subject(s.subject_name, 34)}</span></div>`;
}
const timePill = (pt) => (pt ? `<div class="cell-time">${TT.clock(13)}<span>${rng12(pt.start, pt.end)}</span></div>` : "");

// جدول أسبوعي لصف أو معلم: الأعمدة = أيام الدوام، الصفوف = الدرس الأول، الثاني...
function timetableHtml({ rows, cls, perspective, editable }) {
  const days = workDays();
  const periodsOf = (d) => (cls ? clsPeriods(cls, d) : _dayPeriods[d].length);
  const maxP = Math.max(0, ...days.map((d) => _dayPeriods[d].length));
  const at = (d, p) => rows.find((s) => s.day_of_week === d && s.period_number === p);
  let h = `<table class="timetable tt-days"><thead><tr><th class="corner"></th>${Array.from({ length: maxP }, (_, i) => `<th><span class="th-name">${lessonName(i + 1)}</span><span class="th-ico">${TT.head(i + 1, 24)}</span></th>`).join("")}</tr></thead><tbody>`;
  days.forEach((d) => {
    h += `<tr><th class="period-cell day-cell"><span class="d-ico">${TT.calendar(28)}</span><span class="d-name">${DAY_NAMES[d]}</span><span class="shift-tag">${esc(_dayShift[d] || "")}</span></th>`;
    for (let p = 1; p <= maxP; p++) {
      if (p > periodsOf(d)) { h += `<td class="off"></td>`; continue; }
      const pt = _dayPeriods[d][p - 1], s = at(d, p);
      const drop = editable ? `ondragover="event.preventDefault()" ondrop="dropSlot(event, ${d}, ${p})"` : "";
      h += `<td ${drop}>${timePill(pt)}${s ? slotHtml(s, perspective, editable, d, p) : editable ? `<button class="add-slot" onclick="openSlot(${d}, ${p})" title="إضافة حصة">＋</button>` : ""}</td>`;
    }
    h += "</tr>";
  });
  return h + "</tbody></table>";
}

// الجوال: تبويب لكل يوم + بطاقة لكل درس
function mobileListHtml({ rows, cls, perspective, editable }) {
  const days = workDays();
  if (!days.length) return "";
  if (mobileDay === null || !days.includes(mobileDay)) { const t = new Date().getDay(); mobileDay = days.includes(t) ? t : days[0]; }
  $("dayTabs").classList.remove("hidden");
  $("dayTabs").innerHTML = days.map((d) => `<button class="day-tab ${d === mobileDay ? "active" : ""}" onclick="setMobileDay(${d})">${DAY_NAMES[d]}<small>${esc(_dayShift[d] || "")}</small></button>`).join("");
  const n = cls ? clsPeriods(cls, mobileDay) : _dayPeriods[mobileDay].length;
  let h = '<div class="lesson-list">';
  for (let p = 1; p <= n; p++) {
    const pt = _dayPeriods[mobileDay][p - 1], s = rows.find((x) => x.day_of_week === mobileDay && x.period_number === p);
    h += `<div class="lesson-card"><div class="lesson-no">${lessonName(p)}${timePill(pt)}</div>
      <div class="lesson-body">${s ? slotHtml(s, perspective, editable, mobileDay, p) : editable ? `<button class="add-slot" onclick="openSlot(${mobileDay}, ${p})">＋ إضافة حصة</button>` : '<span class="muted-text">— لا توجد حصة —</span>'}</div></div>`;
  }
  return h + "</div>";
}
function setMobileDay(d) { mobileDay = d; renderGrid(); }

// كل الصفوف: أسبوعياً (جدول لكل صف) أو ليوم واحد (الصفوف × الدروس)
function allClassesHtml() {
  const day = $("scheduleDayFilter").value;
  if (!_classes.length) return '<p class="muted-text pad">أضف صفوفاً أولاً.</p>';
  if (day === "week") {
    return _classes.map((c) => `<div class="class-block compact"><h4>${esc(c.name)}</h4><div class="timetable-wrap">${timetableHtml({ rows: _schedule.filter((s) => s.class_id === c.id), cls: c, perspective: "class", editable: false })}</div></div>`).join("");
  }
  const d = Number(day);
  if (!_dayPeriods[d]) return "";
  const maxP = _dayPeriods[d].length;
  let h = `<table class="timetable matrix"><thead><tr><th>الصف</th>${Array.from({ length: maxP }, (_, i) => `<th>${lessonName(i + 1)}<span class="shift-tag mono">${_dayPeriods[d][i] ? `${rng12(_dayPeriods[d][i].start, _dayPeriods[d][i].end)}` : ""}</span></th>`).join("")}</tr></thead><tbody>`;
  _classes.forEach((c) => {
    const n = clsPeriods(c, d);
    h += `<tr><th class="period-cell class-cell">${esc(c.name)}</th>`;
    for (let p = 1; p <= maxP; p++) {
      const s = _schedule.find((x) => x.class_id === c.id && x.day_of_week === d && x.period_number === p);
      h += p > n ? '<td class="off"></td>' : `<td>${s ? slotHtml(s, "class", false, d, p) : ""}</td>`;
    }
    h += "</tr>";
  });
  return `<p class="muted-text pad">يوم ${DAY_NAMES[d]} — ${esc(_dayShift[d] || "")}</p>` + h + "</tbody></table>";
}

function renderGrid() {
  const { type, value } = currentFilter();
  const grid = $("scheduleGrid");
  $("dayTabs").classList.add("hidden");
  grid.classList.remove("compact");
  if (!workDays().length) { grid.innerHTML = '<p class="muted-text pad">حدّد أيام الدوام من «إعدادات الدوام».</p>'; return; }
  if (type === "all") { grid.style.cssText = "border:none;box-shadow:none;background:transparent"; grid.innerHTML = allClassesHtml(); return; }
  grid.style.cssText = "";
  if (!value) { grid.innerHTML = '<p class="muted-text pad">أضف صفوفاً أو معلمين أولاً.</p>'; return; }
  const rows = _schedule.filter((s) => String(type === "class" ? s.class_id : s.teacher_id) === value);
  const cls = type === "class" ? _classes.find((c) => String(c.id) === value) : null;
  const args = { rows, cls, perspective: type, editable: _status !== "approved" && type === "class" };
  if (isMobile()) { grid.style.cssText = "border:none;box-shadow:none;background:transparent"; grid.innerHTML = mobileListHtml(args); return; }
  grid.innerHTML = timetableHtml(args)
    + (args.editable ? '<p class="muted-text pad">اسحب أي حصة لنقلها إلى خانة فارغة أو لتبديلها مع حصة أخرى، أو اضغط عليها لتعديل المادة/المعلم أو حذفها.</p>' : "");
}

// سحب وإفلات
let dragId = null;
function dragSlot(e, id) { dragId = id; e.dataTransfer.effectAllowed = "move"; }
async function dropSlot(e, day, period) {
  e.preventDefault();
  if (!dragId) return;
  const src = _schedule.find((s) => s.id === dragId), target = _schedule.find((s) => s.class_id === src.class_id && s.day_of_week === day && s.period_number === period);
  dragId = null;
  try {
    if (target && target.id === src.id) return;
    let r;
    if (target) r = await post("/api/schedule/swap", { a: src.id, b: target.id });
    else r = await put(`/api/schedule/${src.id}`, { day_of_week: day, period_number: period });
    if (r && r.warnings && r.warnings.length) toast(r.warnings.join(" · "));
    refreshSchedule();
  } catch (err) { if (err.data && (err.data.suggestions || err.data.conflicts)) showConflict(err); else toast(err.message); }
}

// نافذة تعديل/إضافة حصة
let slotCtx = null;
function openSlot(day, period, id) {
  const { value } = currentFilter();
  const s = id ? _schedule.find((x) => x.id === id) : null;
  slotCtx = { day, period, id, class_id: s ? s.class_id : Number(value) };
  const f = $("slotForm");
  f.subject_id.innerHTML = opts(_subjects, (x) => x.name, s ? s.subject_id : "");
  f.teacher_id.innerHTML = opts(_teachers, (x) => x.name, s ? s.teacher_id : "");
  f.pinned.checked = !!(s && s.lock_kind);
  $("slotMoveRow").classList.toggle("hidden", !id);
  if (id) {
    f.day_of_week.innerHTML = workDays().map((d) => `<option value="${d}" ${d === day ? "selected" : ""}>${DAY_NAMES[d]}</option>`).join("");
    f.period_number.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === period ? "selected" : ""}>${lessonName(i + 1)}</option>`).join("");
  }
  $("slotModalTitle").textContent = `${DAY_NAMES[day]} — الحصة ${period}`;
  $("slotDeleteBtn").classList.toggle("hidden", !id);
  $("slotError").textContent = "";
  $("slotModal").classList.remove("hidden");
}
$("slotCancelBtn").addEventListener("click", () => $("slotModal").classList.add("hidden"));
$("slotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { subject_id: +fd.get("subject_id"), teacher_id: +fd.get("teacher_id"), pinned: fd.get("pinned") === "on" };
  if (slotCtx.id) { body.day_of_week = +fd.get("day_of_week"); body.period_number = +fd.get("period_number"); }
  try {
    const r = slotCtx.id ? await put(`/api/schedule/${slotCtx.id}`, body)
      : await post("/api/schedule", { ...body, class_id: slotCtx.class_id, day_of_week: slotCtx.day, period_number: slotCtx.period });
    if (r.warnings && r.warnings.length) toast(r.warnings.join(" · "));
    $("slotModal").classList.add("hidden"); refreshSchedule();
  } catch (err) { if (err.data && err.data.suggestions) showConflict(err); else $("slotError").textContent = err.message; }
});
$("slotDeleteBtn").addEventListener("click", async () => {
  try { await del(`/api/schedule/${slotCtx.id}`); $("slotModal").classList.add("hidden"); refreshSchedule(); } catch (err) { $("slotError").textContent = err.message; }
});

// طباعة ومشاركة
let _shareCode = "";
function shareCode() { return _shareCode; }
function shareUrl(all) {
  const { type, value } = currentFilter(); const code = shareCode(); const base = `${location.origin}/print.html?s=${code}`;
  if (all || type === "all") return `${base}&all=1`;
  return type === "class" ? `${base}&class_id=${value}` : `${base}&teacher_id=${value}`;
}
$("printBtn").addEventListener("click", () => window.open(shareUrl(false), "_blank"));
$("printAllBtn").addEventListener("click", () => window.open(shareUrl(true), "_blank"));
$("printSchoolBtn").addEventListener("click", () => window.open(`${location.origin}/print.html?s=${shareCode()}&school=1`, "_blank"));
$("shareBtn").addEventListener("click", async () => {
  const url = shareUrl(false);
  try { await navigator.clipboard.writeText(url); $("shareResult").textContent = `تم نسخ الرابط: ${url}`; } catch (e) { $("shareResult").textContent = `الرابط: ${url}`; }
});

// ---------- اسم المدرسة وشعارها ----------
let pendingLogo; // undefined = لم يتغير، "" = حُذف
async function loadSchoolInfo() {
  pendingLogo = undefined;
  const i = await apiFetch("/api/settings/school-info");
  $("schoolInfoForm").school_name.value = i.school_name || ""; $("schoolInfoForm").school_year.value = i.school_year || "";
  if (i.school_logo) { $("logoPreview").src = i.school_logo; $("logoPreviewWrap").classList.remove("hidden"); } else $("logoPreviewWrap").classList.add("hidden");
}
$("schoolInfoForm").querySelector('input[name="school_logo"]').addEventListener("change", (e) => {
  const file = e.target.files[0]; if (!file) return;
  const rd = new FileReader();
  rd.onload = () => { pendingLogo = rd.result; $("logoPreview").src = pendingLogo; $("logoPreviewWrap").classList.remove("hidden"); };
  rd.readAsDataURL(file);
});
$("removeLogoBtn").addEventListener("click", () => { pendingLogo = ""; $("logoPreviewWrap").classList.add("hidden"); $("schoolInfoForm").querySelector('input[name="school_logo"]').value = ""; });
$("schoolInfoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { school_name: fd.get("school_name"), school_year: fd.get("school_year") };
  if (pendingLogo !== undefined) body.school_logo = pendingLogo;
  try { await put("/api/settings/school-info", body); $("schoolInfoResult").textContent = "تم الحفظ ✅"; pendingLogo = undefined; } catch (err) { $("schoolInfoResult").textContent = `خطأ: ${err.message}`; }
});
