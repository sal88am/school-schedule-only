process.env.NODE_PATH = __dirname + "/shim/node_modules";
require("module").Module._initPaths();
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ui-")), "school.db");
process.env.SUPER_ADMIN_PASSWORD = "SuperSecret123";
process.env.ADMIN_PASSWORD = "DefaultAdmin123";
const app = require("../src/app");
const call = (m, u, b, t, x = {}) => app.dispatch(m, u, b, { ...(t ? { authorization: "Bearer " + t } : {}), ...x });
(async () => {
  const A = (await call("POST", "/api/auth/login", { username: "admin", password: "DefaultAdmin123" })).body.token;
  await call("POST", "/api/classes/generate", { grade: "الخامس", sections_count: 2 }, A);
  await call("POST", "/api/classes/generate", { grade: "السادس", sections_count: 1 }, A);
  const S = Object.fromEntries((await call("GET", "/api/subjects", null, A)).body.map((s) => [s.name, s.id]));
  for (const [n, subs] of [["أحمد", ["عربي", "اسلامية"]], ["سارة", ["انكليزي"]], ["علي", ["رياضيات", "علوم"]], ["نور", ["اجتماعيات", "رياضة", "فنية"]]])
    await call("POST", "/api/teachers", { name: n, subject_ids: subs.map((x) => S[x]) }, A);
  const plan = { "عربي": 5, "اسلامية": 2, "رياضيات": 5, "انكليزي": 4, "علوم": 3, "اجتماعيات": 2, "رياضة": 2, "فنية": 1 };
  for (const g of ["الخامس", "السادس"]) for (const [n, w] of Object.entries(plan)) await call("POST", "/api/class-subjects/bulk-grade", { grade: g, subject_id: S[n], weekly_periods: w }, A);
  await call("POST", "/api/teacher-assignments/auto", {}, A);
  await call("PUT", "/api/settings/school-info", { school_name: "مدرسة النور الابتدائية", school_year: "2026 - 2027" }, A);
  await call("POST", "/api/schedule/auto-generate", {}, A);
  const SUP = (await call("POST", "/api/auth/login", { username: "superadmin", password: "SuperSecret123" })).body.token;
  await call("POST", "/api/super/schools", { name: "مدرسة الأمل", admin_username: "amal", admin_password: "AmalPass123" }, SUP);
  const code = (await call("GET", "/api/super/schools", null, SUP)).body[0].share_code;
  console.log("CODE=" + code);
  const root = path.join(__dirname, "..", "public");
  http.createServer((req, res) => {
    const u = req.url;
    if (u.startsWith("/api/")) {
      let body = ""; req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const r = await app.dispatch(req.method, u, body ? JSON.parse(body) : {}, { authorization: req.headers.authorization || "", "x-school-id": req.headers["x-school-id"] || "" });
        res.writeHead(r.status, { "content-type": "application/json" }); res.end(JSON.stringify(r.body));
      });
      return;
    }
    const f = path.join(root, u === "/" ? "index.html" : u.split("?")[0]);
    try { const data = fs.readFileSync(f); res.writeHead(200, { "content-type": { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" }[path.extname(f)] || "text/plain" }); res.end(data); } catch (e) { res.writeHead(404); res.end(); }
  }).listen(4010, () => console.log("harness up"));
})();
