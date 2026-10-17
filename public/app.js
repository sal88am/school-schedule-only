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
  if (!res.ok) throw new Error(data.error || "حدث خطأ غير متوقع");
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
document.querySelectorAll(".nav-link").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
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
    h += `<tr><th class="period-cell"><span class="period-tab">${p}</span></th>`;
    days.forEach((d) => {
      const pt = data.day_periods[d][p - 1]; const r = at(d, p);
      h += `<td>${pt ? `<div class="cell-time">${pt.start}–${pt.end}</div>` : ""}${r ? `<div class="slot" style="--slot-color:#2F4858"><span class="subj">${esc(r.subject_name)}</span><span class="meta">${esc(r.class_name)}</span></div>` : ""}</td>`;
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
    rows.map((r) => `<tr><td>${r.period_number}</td><td class="mono">${r.start_time || "—"}</td><td>${esc(r.subject_name)}</td><td>${esc(r.class_name)}</td><td>${esc(r.teacher_name)}</td></tr>`).join("") || emptyRow(5)}</tbody></table>`;
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
      <label class="field-label">الاستراحة بين الحصص (دقيقة)</label><input type="number" name="break_minutes" min="0" max="60" value="${s.break_minutes}" />
      <button class="btn btn-accent" onclick="saveShift('${s.shift_type}')">حفظ</button>
      <p class="muted-text shift-msg"></p>
    </div>
    <div class="shift-preview">${cfg.preview[s.shift_type].map((p) => `<div><span class="period-tab sm">${p.period}</span><span class="mono">${p.start} – ${p.end}</span></div>`).join("")}</div>
  </div>`).join("");
  const map = Object.fromEntries(cfg.dayConfig.map((d) => [d.day_of_week, d.shift_type]));
  $("dayShiftGrid").innerHTML = DAY_NAMES.map((n, i) => `<label class="day-cell"><span>${n}</span>
    <select data-day="${i}"><option value="">عطلة</option>${cfg.shifts.map((s) => `<option value="${s.shift_type}" ${map[i] === s.shift_type ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>`).join("");
}
async function saveShift(type) {
  const card = document.querySelector(`[data-shift="${type}"]`);
  const g = (n) => card.querySelector(`[name=${n}]`).value;
  try {
    await put(`/api/schedule-config/shift/${type}`, { start_time: g("start_time"), period_count: +g("period_count"), period_minutes: +g("period_minutes"), break_minutes: +g("break_minutes") });
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
}
function fillFilterValues() {
  const type = $("scheduleFilterType").value, sel = $("scheduleFilterValue"), keep = sel.value;
  sel.innerHTML = type === "class" ? opts(_classes, (c) => c.name, keep) : opts(_teachers, (t) => t.name, keep);
}
$("scheduleFilterType").addEventListener("change", () => { fillFilterValues(); renderGrid(); });
$("scheduleFilterValue").addEventListener("change", renderGrid);

async function refreshSchedule() {
  const [sched, report, dp] = await Promise.all([apiFetch("/api/schedule"), apiFetch("/api/schedule/validate"), apiFetch("/api/schedule-config/day-periods")]);
  _schedule = sched; _dayPeriods = dp; _status = report.status;
  const b = $("statusBadge"); b.textContent = statusLabel(_status); b.className = `status-badge ${_status}`;
  $("approveBtn").classList.toggle("hidden", _status === "approved");
  $("unapproveBtn").classList.toggle("hidden", _status !== "approved");
  $("autoGenBtn").disabled = _status === "approved";
  $("manualCard").classList.toggle("hidden", _status === "approved");
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

$("autoGenBtn").addEventListener("click", async () => {
  if (!confirm("سيُستبدل الجدول الحالي بالكامل (بما فيه التعديلات اليدوية). متأكد؟")) return;
  $("autoGenResult").textContent = "جاري التوليد...";
  try {
    const r = await post("/api/schedule/auto-generate");
    $("autoGenResult").textContent = `تم جدولة ${r.filled} من ${r.required} حصة — الدرجة ${r.score}/100` + (r.unfilled ? ` — بقي ${r.unfilled} ناقصة، راجع المشاكل أدناه.` : " ✅");
    refreshSchedule();
  } catch (e) { $("autoGenResult").textContent = `خطأ: ${e.message}`; }
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
    await post("/api/schedule", { teacher_id: +fd.get("teacher_id"), class_id: +fd.get("class_id"), subject_id: +fd.get("subject_id"), day_of_week: +fd.get("day_of_week"), period_number: +fd.get("period_number") });
    refreshSchedule();
  } catch (err) { $("scheduleError").textContent = err.message; }
});

function currentFilter() { return { type: $("scheduleFilterType").value, value: $("scheduleFilterValue").value }; }

function renderGrid() {
  const { type, value } = currentFilter();
  if (!value) { $("scheduleGrid").innerHTML = '<p class="muted-text">أضف صفوفاً أو معلمين أولاً.</p>'; return; }
  const rows = _schedule.filter((s) => String(type === "class" ? s.class_id : s.teacher_id) === value);
  const days = Object.keys(_dayPeriods).map(Number).sort((a, b) => a - b);
  if (!days.length) { $("scheduleGrid").innerHTML = '<p class="muted-text">حدّد أيام الدوام من «إعدادات الدوام».</p>'; return; }
  const cls = type === "class" ? _classes.find((c) => String(c.id) === value) : null;
  const periodsOf = (d) => (cls && cls.custom_periods_per_day ? cls.custom_periods_per_day : _dayPeriods[d].length);
  const maxP = Math.max(...days.map((d) => (cls ? periodsOf(d) : _dayPeriods[d].length)), 0);
  const editable = _status !== "approved" && type === "class";
  const at = (d, p) => rows.find((s) => s.day_of_week === d && s.period_number === p);
  let html = `<table class="timetable"><thead><tr><th></th>${days.map((d) => `<th>${DAY_NAMES[d]}</th>`).join("")}</tr></thead><tbody>`;
  for (let p = 1; p <= maxP; p++) {
    html += `<tr><th class="period-cell"><span class="period-tab">${p}</span></th>`;
    days.forEach((d) => {
      const valid = p <= (cls ? periodsOf(d) : _dayPeriods[d].length);
      if (!valid) { html += `<td class="off"></td>`; return; }
      const pt = _dayPeriods[d][p - 1];
      const time = pt ? `<div class="cell-time">${pt.start}–${pt.end}</div>` : "";
      const s = at(d, p);
      const drop = editable ? `ondragover="event.preventDefault()" ondrop="dropSlot(event, ${d}, ${p})"` : "";
      if (s) {
        html += `<td ${drop}>${time}<div class="slot" ${editable ? `draggable="true" ondragstart="dragSlot(event, ${s.id})" onclick="openSlot(${d}, ${p}, ${s.id})"` : ""} style="--slot-color:${esc(s.subject_color || "#2F4858")}">
          <span class="subj">${esc(s.subject_name)}</span><span class="meta">${esc(type === "class" ? s.teacher_name : s.class_name)}</span></div></td>`;
      } else {
        html += `<td ${drop}>${time}${editable ? `<button class="add-slot" onclick="openSlot(${d}, ${p})" title="إضافة حصة">＋</button>` : ""}</td>`;
      }
    });
    html += "</tr>";
  }
  $("scheduleGrid").innerHTML = html + "</tbody></table>"
    + (editable ? '<p class="muted-text pad">اسحب أي حصة لنقلها إلى خانة فارغة أو لتبديلها مع حصة أخرى، أو اضغط عليها لتعديل المادة/المعلم أو حذفها.</p>' : "");
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
    if (target) await post("/api/schedule/swap", { a: src.id, b: target.id });
    else await put(`/api/schedule/${src.id}`, { day_of_week: day, period_number: period });
    refreshSchedule();
  } catch (err) { alert(err.message); }
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
  $("slotModalTitle").textContent = `${DAY_NAMES[day]} — الحصة ${period}`;
  $("slotDeleteBtn").classList.toggle("hidden", !id);
  $("slotError").textContent = "";
  $("slotModal").classList.remove("hidden");
}
$("slotCancelBtn").addEventListener("click", () => $("slotModal").classList.add("hidden"));
$("slotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = { subject_id: +fd.get("subject_id"), teacher_id: +fd.get("teacher_id") };
  try {
    if (slotCtx.id) await put(`/api/schedule/${slotCtx.id}`, body);
    else await post("/api/schedule", { ...body, class_id: slotCtx.class_id, day_of_week: slotCtx.day, period_number: slotCtx.period });
    $("slotModal").classList.add("hidden"); refreshSchedule();
  } catch (err) { $("slotError").textContent = err.message; }
});
$("slotDeleteBtn").addEventListener("click", async () => {
  try { await del(`/api/schedule/${slotCtx.id}`); $("slotModal").classList.add("hidden"); refreshSchedule(); } catch (err) { $("slotError").textContent = err.message; }
});

// طباعة ومشاركة
let _shareCode = "";
function shareCode() { return _shareCode; }
function shareUrl(all) {
  const { type, value } = currentFilter(); const code = shareCode(); const base = `${location.origin}/print.html?s=${code}`;
  if (all) return `${base}&all=1`;
  return type === "class" ? `${base}&class_id=${value}` : `${base}&teacher_id=${value}`;
}
$("printBtn").addEventListener("click", () => window.open(shareUrl(false), "_blank"));
$("printAllBtn").addEventListener("click", () => window.open(shareUrl(true), "_blank"));
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
