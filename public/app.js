const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

// ---------- طبقة الاتصال بالـ API ----------
function getPassword() {
  return localStorage.getItem("admin_pw") || "";
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": getPassword(),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "حدث خطأ غير متوقع");
  return data;
}

// ---------- تسجيل الدخول ----------
const loginScreen = document.getElementById("loginScreen");
const appEl = document.getElementById("app");

document.getElementById("loginBtn").addEventListener("click", tryLogin);
document.getElementById("pwInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") tryLogin();
});

async function tryLogin() {
  const pw = document.getElementById("pwInput").value;
  localStorage.setItem("admin_pw", pw);
  try {
    await apiFetch("/api/teachers");
    loginScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    boot();
  } catch (err) {
    document.getElementById("loginError").textContent = "كلمة المرور غير صحيحة";
  }
}

(async function autoLogin() {
  if (!getPassword()) return;
  try {
    await apiFetch("/api/teachers");
    loginScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    boot();
  } catch (err) {
    /* يبقى بشاشة الدخول */
  }
})();

// ---------- التنقل ----------
document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
    refreshView(btn.dataset.view);
  });
});

function refreshView(view) {
  if (view === "dashboard") loadDashboard();
  if (view === "teachers") { loadSpecialtyOptions(); loadTeachers(); }
  if (view === "subjects") loadSubjects();
  if (view === "classes") loadClasses();
  if (view === "periodTimes") loadPeriodTimes();
  if (view === "schedule") loadScheduleView();
  if (view === "settings") { loadWorkingDays(); loadSchoolInfo(); }
}

function boot() {
  loadDashboard();
}

// ---------- لوحة النظرة العامة ----------
async function loadDashboard() {
  const [teachers, classes, subjects, schedule] = await Promise.all([
    apiFetch("/api/teachers"),
    apiFetch("/api/classes"),
    apiFetch("/api/subjects"),
    apiFetch("/api/schedule"),
  ]);

  document.getElementById("statGrid").innerHTML = `
    ${statCard(teachers.length, "معلم مسجّل")}
    ${statCard(subjects.length, "مادة دراسية")}
    ${statCard(classes.length, "صف/شعبة")}
    ${statCard(schedule.length, "حصة موزّعة بالجدول")}
  `;

  const today = new Date().getDay();
  const todayRows = schedule
    .filter((s) => s.day_of_week === today)
    .sort((a, b) => a.period_number - b.period_number || a.class_name.localeCompare(b.class_name));

  document.getElementById("todaySchedule").innerHTML = `
    <table>
      <thead><tr><th>الحصة</th><th>الوقت</th><th>المادة</th><th>الصف</th><th>المعلم</th></tr></thead>
      <tbody>${
        todayRows
          .map(
            (r) => `<tr>
              <td>${r.period_number}</td>
              <td class="mono">${r.start_time || "—"}</td>
              <td>${r.subject_name}</td>
              <td>${r.class_name}</td>
              <td>${r.teacher_name}</td>
            </tr>`
          )
          .join("") || emptyRow(5)
      }</tbody>
    </table>`;
}

function statCard(num, label) {
  return `<div class="stat-card"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}

// ---------- المعلمون ----------
async function loadSpecialtyOptions() {
  const subjects = await apiFetch("/api/subjects");
  const select = document.getElementById("teacherSpecialtySelect");
  select.innerHTML =
    `<option value="">اختر التخصص (مادة)</option>` +
    subjects.map((s) => `<option value="${s.name}">${s.name}</option>`).join("");
}

document.getElementById("teacherForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  await apiFetch("/api/teachers", { method: "POST", body: JSON.stringify(payload) });
  e.target.reset();
  loadTeachers();
});

async function loadTeachers() {
  const teachers = await apiFetch("/api/teachers");
  const rows = teachers
    .map(
      (t) => `
    <tr>
      <td>${t.name}</td>
      <td>${t.specialty || "—"}</td>
      <td>${t.phone || "—"}</td>
      <td><button class="btn btn-danger" onclick="deleteTeacher(${t.id})">حذف</button></td>
    </tr>`
    )
    .join("");

  document.getElementById("teachersTable").innerHTML = `
    <table>
      <thead><tr><th>الاسم</th><th>التخصص</th><th>الهاتف</th><th></th></tr></thead>
      <tbody>${rows || emptyRow(4)}</tbody>
    </table>`;
}

async function deleteTeacher(id) {
  if (!confirm("حذف هذا المعلم؟ راح ينحذف من جدوله أيضاً.")) return;
  await apiFetch(`/api/teachers/${id}`, { method: "DELETE" });
  loadTeachers();
}

// ---------- المواد ----------
document.getElementById("subjectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  await apiFetch("/api/subjects", { method: "POST", body: JSON.stringify(Object.fromEntries(fd.entries())) });
  e.target.reset();
  loadSubjects();
});

async function loadSubjects() {
  const subjects = await apiFetch("/api/subjects");
  document.getElementById("subjectsTable").innerHTML = `
    <table><tbody>
      ${subjects.map((s) => `<tr><td>${s.name}</td><td><button class="btn btn-danger" onclick="deleteItem('subjects', ${s.id}, loadSubjects)">حذف</button></td></tr>`).join("") || emptyRow(2)}
    </tbody></table>`;
}

async function deleteItem(resource, id, callback) {
  await apiFetch(`/api/${resource}/${id}`, { method: "DELETE" });
  callback();
}

// ---------- الصفوف والشعب ----------
document.getElementById("classGenForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  payload.sections_count = Number(payload.sections_count);
  payload.periods_per_day = Number(payload.periods_per_day);
  document.getElementById("classGenError").textContent = "";
  try {
    const result = await apiFetch("/api/classes/generate", { method: "POST", body: JSON.stringify(payload) });
    if (result.skipped && result.skipped.length) {
      document.getElementById("classGenError").textContent = `تم التوليد، لكن هذي الشعب موجودة أصلاً: ${result.skipped.join("، ")}`;
    }
    e.target.reset();
    loadClasses();
  } catch (err) {
    document.getElementById("classGenError").textContent = err.message;
  }
});

async function loadClasses() {
  const classes = await apiFetch("/api/classes");
  document.getElementById("classesTable").innerHTML = `
    <table>
      <thead><tr><th>الصف</th><th>المرحلة</th><th>الشعبة</th><th>حصص/يوم</th><th></th></tr></thead>
      <tbody>${
        classes
          .map(
            (c) => `<tr>
          <td>${c.name}</td>
          <td>${c.grade}</td>
          <td>${c.section}</td>
          <td>${c.periods_per_day}</td>
          <td><button class="btn btn-danger" onclick="deleteItem('classes', ${c.id}, loadClasses)">حذف</button></td>
        </tr>`
          )
          .join("") || emptyRow(5)
      }</tbody>
    </table>`;
}

// ---------- توقيت الحصص ----------
document.getElementById("periodTimeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  payload.period_number = Number(payload.period_number);
  await apiFetch("/api/period-times", { method: "POST", body: JSON.stringify(payload) });
  e.target.reset();
  loadPeriodTimes();
});

const DAY_NAMES_SHORT = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

async function loadPeriodTimes() {
  const rows = await apiFetch("/api/period-times");
  const byPeriod = {};
  rows.forEach((r) => {
    if (!byPeriod[r.period_number]) byPeriod[r.period_number] = [];
    byPeriod[r.period_number].push(r);
  });

  const periodNumbers = Object.keys(byPeriod).map(Number).sort((a, b) => a - b);

  const tableRows = periodNumbers
    .map((num) => {
      const entries = byPeriod[num].sort((a, b) => a.day_of_week - b.day_of_week);
      return entries
        .map((r) => {
          const dayLabel = r.day_of_week === -1 ? "كل أيام الدوام" : DAY_NAMES_SHORT[r.day_of_week];
          return `<tr>
            <td>الحصة ${r.period_number}</td>
            <td>${dayLabel}</td>
            <td class="mono">${r.start_time || "—"}</td>
            <td class="mono">${r.end_time || "—"}</td>
            <td><button class="btn btn-danger" onclick="deletePeriodTime(${r.day_of_week}, ${r.period_number})">حذف</button></td>
          </tr>`;
        })
        .join("");
    })
    .join("");

  document.getElementById("periodTimesTable").innerHTML = `
    <table>
      <thead><tr><th>رقم الحصة</th><th>اليوم</th><th>من</th><th>إلى</th><th></th></tr></thead>
      <tbody>${tableRows || emptyRow(5)}</tbody>
    </table>`;
}

async function deletePeriodTime(dayOfWeek, periodNumber) {
  await apiFetch(`/api/period-times/${dayOfWeek}/${periodNumber}`, { method: "DELETE" });
  loadPeriodTimes();
}

// ---------- الجدول الدراسي ----------
let allTeachers = [];
let allClasses = [];

document.getElementById("autoGenBtn").addEventListener("click", async () => {
  if (!confirm("هذا راح يمسح الجدول الحالي بالكامل ويولّد جدول جديد تلقائياً. متأكد؟")) return;
  const resultEl = document.getElementById("autoGenResult");
  resultEl.textContent = "جاري التوليد...";
  try {
    const result = await apiFetch("/api/schedule/auto-generate", { method: "POST" });
    resultEl.textContent = result.unfilled > 0
      ? `تم تعبئة ${result.filled} حصة. بقيت ${result.unfilled} حصة فارغة — أضف معلمين لتغطية بقية المواد أو عدّلها يدوياً.`
      : `تم توليد الجدول بالكامل بنجاح (${result.filled} حصة).`;
    loadScheduleView();
  } catch (err) {
    resultEl.textContent = `خطأ: ${err.message}`;
  }
});

async function loadScheduleView() {
  const form = document.getElementById("scheduleForm");
  const [teachers, classes, subjects] = await Promise.all([
    apiFetch("/api/teachers"),
    apiFetch("/api/classes"),
    apiFetch("/api/subjects"),
  ]);
  allTeachers = teachers;
  allClasses = classes;

  fillSelect(form.teacher_id, teachers, (t) => t.name);
  fillSelect(form.class_id, classes, (c) => c.name);
  fillSelect(form.subject_id, subjects, (s) => s.name);

  setupScheduleFilter();
  await renderFilteredSchedule();
}

function fillSelect(select, items, labelFn) {
  select.innerHTML = items.map((i) => `<option value="${i.id}">${labelFn(i)}</option>`).join("");
}

document.getElementById("scheduleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    teacher_id: Number(fd.get("teacher_id")),
    class_id: Number(fd.get("class_id")),
    subject_id: Number(fd.get("subject_id")),
    day_of_week: Number(fd.get("day_of_week")),
    period_number: Number(fd.get("period_number")),
  };
  document.getElementById("scheduleError").textContent = "";
  try {
    await apiFetch("/api/schedule", { method: "POST", body: JSON.stringify(payload) });
    renderFilteredSchedule();
  } catch (err) {
    document.getElementById("scheduleError").textContent = err.message;
  }
});

function setupScheduleFilter() {
  const typeSelect = document.getElementById("scheduleFilterType");
  const valueSelect = document.getElementById("scheduleFilterValue");

  typeSelect.onchange = () => {
    if (typeSelect.value === "class") {
      valueSelect.classList.remove("hidden");
      fillSelect(valueSelect, allClasses, (c) => c.name);
    } else if (typeSelect.value === "teacher") {
      valueSelect.classList.remove("hidden");
      fillSelect(valueSelect, allTeachers, (t) => t.name);
    } else {
      valueSelect.classList.add("hidden");
    }
    renderFilteredSchedule();
  };
  valueSelect.onchange = renderFilteredSchedule;
}

function getCurrentFilter() {
  const type = document.getElementById("scheduleFilterType").value;
  const value = document.getElementById("scheduleFilterValue").value;
  return { type, value };
}

async function renderFilteredSchedule() {
  const schedule = await apiFetch("/api/schedule");
  const { type, value } = getCurrentFilter();

  let filtered = schedule;
  if (type === "class" && value) filtered = schedule.filter((s) => String(s.class_id) === value);
  if (type === "teacher" && value) filtered = schedule.filter((s) => String(s.teacher_id) === value);

  renderTimetable(filtered);
}

function renderTimetable(schedule) {
  const periodNumbers = [...new Set(schedule.map((s) => s.period_number))].sort((a, b) => a - b);
  const byDayPeriod = {};
  schedule.forEach((s) => {
    const key = `${s.day_of_week}-${s.period_number}`;
    if (!byDayPeriod[key]) byDayPeriod[key] = [];
    byDayPeriod[key].push(s);
  });

  let html = `<table class="timetable"><thead><tr><th></th>${DAY_NAMES.map((d) => `<th>${d}</th>`).join("")}</tr></thead><tbody>`;

  periodNumbers.forEach((num) => {
    const timeRow = schedule.find((s) => s.period_number === num);
    const timeLabel = timeRow && timeRow.start_time ? `<div class="period-time">${timeRow.start_time}</div>` : "";
    html += `<tr><th class="period-cell"><span class="period-tab">${num}</span>${timeLabel}</th>`;
    DAY_NAMES.forEach((_, dayIdx) => {
      const entries = byDayPeriod[`${dayIdx}-${num}`] || [];
      html += "<td>";
      entries.forEach((entry) => {
        html += `<div class="slot" style="--slot-color:${subjectColor(entry.subject_name)}">
          <span class="del" onclick="deleteSchedule(${entry.id})" title="حذف">✕</span>
          <span class="subj">${entry.subject_name}</span>
          <span class="meta">${entry.class_name} · ${entry.teacher_name}</span>
        </div>`;
      });
      html += "</td>";
    });
    html += "</tr>";
  });

  html += "</tbody></table>";
  document.getElementById("scheduleGrid").innerHTML =
    periodNumbers.length ? html : '<p class="muted-text">ما فيه جدول بعد — ولّده تلقائياً أو أضف حصص يدوياً.</p>';
}

// لون ثابت لكل مادة (نفس المادة نفس اللون دائماً) — يخلي الجدول أوضح للعين
const SUBJECT_PALETTE = ["#2F4858", "#C98A3E", "#4C7A6B", "#8E5B45", "#5B6EA8", "#8B6F9E", "#B4533C", "#5D8A6E"];
function subjectColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return SUBJECT_PALETTE[hash % SUBJECT_PALETTE.length];
}

async function deleteSchedule(id) {
  if (!confirm("حذف هذه الحصة من الجدول؟")) return;
  await apiFetch(`/api/schedule/${id}`, { method: "DELETE" });
  renderFilteredSchedule();
}

document.getElementById("printBtn").addEventListener("click", () => {
  window.open(buildShareUrl(), "_blank");
});

document.getElementById("shareBtn").addEventListener("click", async () => {
  const url = buildShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    document.getElementById("shareResult").textContent = `تم نسخ الرابط: ${url}`;
  } catch (err) {
    document.getElementById("shareResult").textContent = `الرابط: ${url}`;
  }
});

function buildShareUrl() {
  const { type, value } = getCurrentFilter();
  const base = `${location.origin}/print.html`;
  if (type === "class" && value) return `${base}?class_id=${value}`;
  if (type === "teacher" && value) return `${base}?teacher_id=${value}`;
  return base;
}

// ---------- الإعدادات ----------
async function loadWorkingDays() {
  const { working_days } = await apiFetch("/api/settings/working-days");
  document.querySelectorAll('#workingDaysForm input[type="checkbox"]').forEach((cb) => {
    cb.checked = working_days.includes(Number(cb.value));
  });
}

document.getElementById("workingDaysForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const selected = [...document.querySelectorAll('#workingDaysForm input[type="checkbox"]:checked')].map((cb) =>
    Number(cb.value)
  );
  try {
    await apiFetch("/api/settings/working-days", { method: "PUT", body: JSON.stringify({ working_days: selected }) });
    document.getElementById("workingDaysResult").textContent = "تم الحفظ ✅";
  } catch (err) {
    document.getElementById("workingDaysResult").textContent = `خطأ: ${err.message}`;
  }
});

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" class="muted-text">لا توجد بيانات بعد</td></tr>`;
}

// ---------- اسم المدرسة وشعارها ----------
let pendingLogoDataUrl = undefined; // undefined = ما تغيّر، "" = انحذف، غير هذا = صورة جديدة

async function loadSchoolInfo() {
  pendingLogoDataUrl = undefined;
  const info = await apiFetch("/api/settings/school-info");
  document.getElementById("schoolInfoForm").school_name.value = info.school_name || "";
  const previewWrap = document.getElementById("logoPreviewWrap");
  const preview = document.getElementById("logoPreview");
  if (info.school_logo) {
    preview.src = info.school_logo;
    previewWrap.classList.remove("hidden");
  } else {
    previewWrap.classList.add("hidden");
  }
}

document.getElementById("schoolInfoForm").querySelector('input[name="school_logo"]').addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingLogoDataUrl = reader.result;
    document.getElementById("logoPreview").src = pendingLogoDataUrl;
    document.getElementById("logoPreviewWrap").classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

document.getElementById("removeLogoBtn").addEventListener("click", () => {
  pendingLogoDataUrl = "";
  document.getElementById("logoPreviewWrap").classList.add("hidden");
  document.getElementById("schoolInfoForm").querySelector('input[name="school_logo"]').value = "";
});

document.getElementById("schoolInfoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = { school_name: fd.get("school_name") };
  if (pendingLogoDataUrl !== undefined) payload.school_logo = pendingLogoDataUrl;
  try {
    await apiFetch("/api/settings/school-info", { method: "PUT", body: JSON.stringify(payload) });
    document.getElementById("schoolInfoResult").textContent = "تم الحفظ ✅";
    pendingLogoDataUrl = undefined;
  } catch (err) {
    document.getElementById("schoolInfoResult").textContent = `خطأ: ${err.message}`;
  }
});
