// أيقونات الجدول (مشتركة بين التطبيق والطباعة) — SVG خطّي بلون currentColor
(function () {
  const P = {
    book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/><path d="M6 8.5c1.3 0 2.4.2 3.5.7M6 11.5c1.3 0 2.4.2 3.5.7M18 8.5c-1.3 0-2.4.2-3.5.7M18 11.5c-1.3 0-2.4.2-3.5.7"/>',
    calc: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="8" y="5.5" width="8" height="3.5" rx=".8"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16h.01M12 16h.01M15.5 16h.01M8.5 19h.01M12 19h.01M15.5 19h.01" stroke-width="2.4"/>',
    abc: '<rect x="3" y="3" width="8.5" height="8.5" rx="1.5"/><rect x="12.5" y="12.5" width="8.5" height="8.5" rx="1.5"/><rect x="3" y="12.5" width="8.5" height="8.5" rx="1.5"/><path d="M5.5 9.5l1.8-4.5 1.8 4.5M6 8h2.6"/><path d="M5.5 15v5M5.5 15h2a1.2 1.2 0 010 2.4h-2M5.5 17.4h2.3a1.3 1.3 0 010 2.6H5.5"/><path d="M18.5 14.6a2.2 2.2 0 100 5"/>',
    palette: '<path d="M12 3a9 9 0 100 18c1.4 0 2-.9 1.6-2-.4-1.2.3-2.2 1.5-2.2H17a4 4 0 004-4C21 7 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10" cy="7.3" r="1.1"/><circle cx="14.5" cy="7.3" r="1.1"/><circle cx="17" cy="11" r="1.1"/>',
    atom: '<circle cx="12" cy="12" r="1.8"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
    people: '<circle cx="12" cy="8" r="3"/><path d="M6.5 20v-1.5a5.5 5.5 0 0111 0V20"/><circle cx="5" cy="10" r="2.2"/><path d="M1.5 18.5v-1a3.6 3.6 0 013.5-3.5"/><circle cx="19" cy="10" r="2.2"/><path d="M22.5 18.5v-1A3.6 3.6 0 0019 14"/>',
    mosque: '<path d="M12 2.5c0 1.2-.8 1.8-.8 2.6a.8.8 0 001.6 0c0-.8-.8-1.4-.8-2.6z"/><path d="M7.5 12a4.5 4.5 0 019 0"/><path d="M6 12h12v9H6z"/><path d="M10.5 21v-3.5a1.5 1.5 0 013 0V21"/><path d="M3.5 21V9.5l1.2-2 1.2 2V21M18.1 21V9.5l1.2-2 1.2 2V21"/>',
    run: '<circle cx="15" cy="4.5" r="2"/><path d="M12 9l-3 2.5-2.5-.5M12 9l2.5 2 3 .5M12 9l-1 5 3.5 2.5.5 5M11 14l-3 3.5-3 1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 19a1.6 1.6 0 001.4 2.4h12.2a1.6 1.6 0 001.4-2.4L14 9V3"/><path d="M7.5 15h9"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01M16 17h.01" stroke-width="2.2"/>',
    school: '<path d="M3 9.5L12 4l9 5.5-9 5.5z"/><path d="M6.5 12v4.5c0 1 2.5 2.5 5.5 2.5s5.5-1.5 5.5-2.5V12"/>',
  };
  // كلمات مفتاحية → أيقونة (يطابق اسم المادة)
  const MAP = [
    [/عرب|لغتي|قراء|إملاء|املاء|نحو|قواعد|أدب|ادب/, "book"],
    [/رياض|حساب|جبر|هندس/, "calc"],
    [/انكل|إنجل|انجل|english|لغة أجنب|لغه اجنب|فرنس/i, "abc"],
    [/فن|رسم|تشكيل/, "palette"],
    [/علوم|فيزياء|أحياء|احياء|science/i, "atom"],
    [/كيمي/, "flask"],
    [/اخلاق|أخلاق|تربية وطن|وطني|مجتمع|اجتماع|مدني/, "people"],
    [/اسلام|إسلام|دين|قرآن|قران|تربية إسلام/, "mosque"],
    [/رياضة|بدني|رياضه|تربية بدن/, "run"],
    [/جغراف|تاريخ|دراسات/, "globe"],
    [/حاسوب|حاسب|كمبيوتر|تقنية|معلوماتية/, "laptop"],
    [/موسيق|نشيد|أناشيد|اناشيد/, "music"],
  ];
  const HEAD = ["book", "calc", "abc", "palette", "atom", "people", "mosque", "globe", "flask", "music", "laptop", "run"];
  function icon(name, size, cls) {
    const s = size || 22;
    return `<svg class="ico ${cls || ""}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.school}</svg>`;
  }
  function subjectIconName(subjectName) {
    const n = String(subjectName || "");
    for (const [re, ic] of MAP) if (re.test(n)) return ic;
    return "book";
  }
  window.TT = {
    icon,
    subject: (name, size, cls) => icon(subjectIconName(name), size, cls),
    head: (i, size) => icon(HEAD[(i - 1) % HEAD.length], size || 22),
    clock: (size) => icon("clock", size || 13),
    calendar: (size) => icon("calendar", size || 26),
  };
})();
