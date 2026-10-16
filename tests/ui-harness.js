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

const http = require("http");
(async () => {
  await call("POST", "/api/classes/generate", { grade: "الخامس", sections_count: 2 });
  await call("POST", "/api/classes/generate", { grade: "السادس", sections_count: 1 });
  const subjects = (await call("GET", "/api/subjects")).body; const S = Object.fromEntries(subjects.map((s) => [s.name, s.id]));
  for (const [n, subs] of [["أحمد", ["عربي", "اسلامية"]], ["سارة", ["انكليزي"]], ["علي", ["رياضيات", "علوم"]], ["نور", ["اجتماعيات", "رياضة", "فنية"]]])
    await call("POST", "/api/teachers", { name: n, subject_ids: subs.map((x) => S[x]) });
  const plan = { "عربي": 5, "اسلامية": 2, "رياضيات": 5, "انكليزي": 4, "علوم": 3, "اجتماعيات": 2, "رياضة": 2, "فنية": 1 };
  for (const g of ["الخامس", "السادس"]) for (const [n, w] of Object.entries(plan)) await call("POST", "/api/class-subjects/bulk-grade", { grade: g, subject_id: S[n], weekly_periods: w });
  await call("POST", "/api/teacher-assignments/auto");
  await call("PUT", "/api/settings/school-info", { school_name: "مدرسة النور الابتدائية", school_year: "2026 - 2027" });
  await call("POST", "/api/schedule/auto-generate");
  const root = path.join(__dirname, "..", "public");
  http.createServer(async (req, res) => {
    const u = req.url;
    if (u.startsWith("/api/")) {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try { const r = await call(req.method, u, body ? JSON.parse(body) : {}); res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify(r.body)); }
        catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
      });
      return;
    }
    const f = path.join(root, u === "/" ? "index.html" : u.split("?")[0]);
    try { const data = fs.readFileSync(f); const ext = path.extname(f); res.writeHead(200, { "content-type": { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }[ext] || "text/plain" }); res.end(data); } catch (e) { res.writeHead(404); res.end(); }
  }).listen(4010, () => console.log("harness up"));
})();
