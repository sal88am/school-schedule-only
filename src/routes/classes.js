const express = require("express");
const db = require("../db");

const router = express.Router();

// حروف الشعب بترتيب "أبجد هوز" التقليدي
const SECTION_LETTERS = [
  "أ", "ب", "ج", "د", "ه", "و", "ز", "ح", "ط", "ي",
  "ك", "ل", "م", "ن", "س", "ع", "ف", "ص", "ق", "ر",
  "ش", "ت", "ث", "خ", "ذ", "ض", "ظ", "غ",
];

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM school_classes ORDER BY id").all());
});

// توليد شعب صف دراسي كامل دفعة وحدة: مثال (الأول، 3 شعب، 6 حصص باليوم)
// ينشئ: "الأول أ", "الأول ب", "الأول ج" — كل وحدة عندها نفس عدد الحصص باليوم
router.post("/generate", (req, res) => {
  const { grade, sections_count, periods_per_day } = req.body;
  const count = Number(sections_count);
  const perDay = Number(periods_per_day);

  if (!grade || !grade.trim()) {
    return res.status(400).json({ error: "اسم المرحلة الدراسية مطلوب" });
  }
  if (!count || count < 1 || count > SECTION_LETTERS.length) {
    return res.status(400).json({ error: `عدد الشعب لازم يكون بين 1 و ${SECTION_LETTERS.length}` });
  }
  if (!perDay || perDay < 1 || perDay > 12) {
    return res.status(400).json({ error: "عدد الحصص باليوم لازم يكون بين 1 و 12" });
  }

  const insert = db.prepare(
    "INSERT INTO school_classes (name, grade, section, periods_per_day) VALUES (?, ?, ?, ?)"
  );

  const created = [];
  const skipped = [];

  for (let i = 0; i < count; i++) {
    const section = SECTION_LETTERS[i];
    const name = `${grade.trim()} ${section}`;
    const exists = db.prepare("SELECT 1 FROM school_classes WHERE name = ?").get(name);
    if (exists) {
      skipped.push(name);
      continue;
    }
    const result = insert.run(name, grade.trim(), section, perDay);
    created.push(db.prepare("SELECT * FROM school_classes WHERE id = ?").get(result.lastInsertRowid));
  }

  res.status(201).json({ created, skipped });
});

// تعديل عدد الحصص باليوم لصف معين
router.put("/:id", (req, res) => {
  const { periods_per_day } = req.body;
  const cls = db.prepare("SELECT * FROM school_classes WHERE id = ?").get(req.params.id);
  if (!cls) return res.status(404).json({ error: "الصف غير موجود" });

  db.prepare("UPDATE school_classes SET periods_per_day = ? WHERE id = ?").run(
    periods_per_day ? Number(periods_per_day) : cls.periods_per_day,
    req.params.id
  );
  res.json(db.prepare("SELECT * FROM school_classes WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM school_classes WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
