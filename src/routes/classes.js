const express = require("express");
const db = require("../db");
const { owned } = require("./util");
const router = express.Router();

const SECTION_LETTERS = ["أ","ب","ج","د","ه","و","ز","ح","ط","ي","ك","ل","م","ن","س","ع","ف","ص","ق","ر","ش","ت","ث","خ","ذ","ض","ظ","غ"];
const GRADES = ["الأول","الثاني","الثالث","الرابع","الخامس","السادس"];

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM school_classes WHERE school_id = ?").all(req.schoolId);
  rows.sort((a, b) => {
    const g = GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade);
    return g || SECTION_LETTERS.indexOf(a.section) - SECTION_LETTERS.indexOf(b.section) || a.id - b.id;
  });
  const pm = require("../services/scheduleTime.service").classPeriodsMap(req.schoolId);
  res.json(rows.map((r) => ({ ...r, periods_by_day: pm[r.id] || {} })));
});

router.post("/generate", (req, res) => {
  const { grade } = req.body;
  const count = Number(req.body.sections_count);
  if (!grade || !grade.trim()) return res.status(400).json({ error: "اسم المرحلة الدراسية مطلوب" });
  if (!count || count < 1 || count > SECTION_LETTERS.length) return res.status(400).json({ error: `عدد الشعب بين 1 و ${SECTION_LETTERS.length}` });
  const custom = req.body.periods_per_day ? Number(req.body.periods_per_day) : null;
  const ins = db.prepare("INSERT INTO school_classes (school_id, name, grade, section, periods_per_day, custom_periods_per_day) VALUES (?,?,?,?,?,?)");
  const created = [], skipped = [];
  for (let i = 0; i < count; i++) {
    const name = `${grade.trim()} ${SECTION_LETTERS[i]}`;
    if (db.prepare("SELECT 1 FROM school_classes WHERE school_id = ? AND name = ?").get(req.schoolId, name)) { skipped.push(name); continue; }
    const r = ins.run(req.schoolId, name, grade.trim(), SECTION_LETTERS[i], custom || 6, custom);
    created.push(db.prepare("SELECT * FROM school_classes WHERE id = ?").get(r.lastInsertRowid));
  }
  res.status(201).json({ created, skipped });
});

router.put("/:id", (req, res) => {
  const cls = owned("classes", req.params.id, req.schoolId);
  if (!cls) return res.status(404).json({ error: "الصف غير موجود" });
  let custom = cls.custom_periods_per_day;
  if ("custom_periods_per_day" in req.body) {
    custom = req.body.custom_periods_per_day ? Number(req.body.custom_periods_per_day) : null;
    if (custom !== null && !(custom >= 1 && custom <= 12)) return res.status(400).json({ error: "عدد الحصص بين 1 و 12" });
  }
  db.prepare("UPDATE school_classes SET custom_periods_per_day = ? WHERE id = ? AND school_id = ?").run(custom, cls.id, req.schoolId);
  res.json(db.prepare("SELECT * FROM school_classes WHERE id = ?").get(cls.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM school_classes WHERE id = ? AND school_id = ?").run(req.params.id, req.schoolId);
  res.json({ ok: true });
});
module.exports = router;
