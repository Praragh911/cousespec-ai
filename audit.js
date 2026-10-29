"use strict";
/*
 * CourseSpec AI - audit engine
 *   extractText()  reads a PDF / DOCX and returns its text
 *   analyze()      runs the real checks on that text and returns findings, outcomes, mapping, score
 *   aiPolish() / aiSuggestMapping()   optional, only used when ANTHROPIC_API_KEY is set
 */
const fs = require("fs");

const PENALTY = { Critical: 8, Warning: 4, Suggestion: 1 }; // points lost per finding (and regained when accepted)

/* ======================= 1. Reading the file ======================= */
function renderPage(pageData) {
    return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((tc) => {
        let lastY, out = "";
        for (const it of tc.items) {
            if (lastY === undefined) out += it.str;
            else if (lastY === it.transform[5]) out += (/\s$/.test(out) || /^\s/.test(it.str) ? "" : " ") + it.str; // same row (table cells)
            else out += "\n" + it.str;
            lastY = it.transform[5];
        }
        return out + "\f"; // page marker, used later to report page numbers
    });
}

async function extractText(filePath, ext) {
    ext = String(ext || "").toLowerCase();
    let text, pages;
    if (ext === ".pdf") {
        const pdfParse = require("pdf-parse");
        const res = await pdfParse(fs.readFileSync(filePath), { pagerender: renderPage });
        text = res.text;
        pages = res.numpages;
    } else if (ext === ".docx") {
        const mammoth = require("mammoth");
        text = (await mammoth.extractRawText({ path: filePath })).value;
    } else if (ext === ".txt") { // not offered in the upload form; handy for testing
        text = fs.readFileSync(filePath, "utf8");
    } else throw new Error("Only PDF or DOCX files are supported");
    if (!pages) pages = Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 450));
    if (text.replace(/\s+/g, "").length < 200)
        throw new Error("No readable text was found in this file. If it is a scanned PDF, it needs OCR first (not supported yet).");
    return { text, pages };
}

/* ======================= 2. Knowledge tables ======================= */
const BLOOM = {
    L1: ["define", "list", "recall", "identify", "name", "state", "recognize", "label", "memorize", "repeat", "retrieve"],
    L2: ["understand", "explain", "describe", "summarize", "summarise", "discuss", "classify", "interpret", "illustrate", "outline", "paraphrase", "predict", "compare"],
    L3: ["apply", "implement", "use", "solve", "demonstrate", "execute", "compute", "select", "choose", "perform", "write", "operate", "calculate", "employ", "practice"],
    L4: ["analyze", "analyse", "differentiate", "examine", "contrast", "investigate", "distinguish", "categorize", "deconstruct", "test", "diagnose", "organize"],
    L5: ["evaluate", "assess", "justify", "critique", "judge", "recommend", "validate", "appraise", "argue", "defend", "verify", "prioritize", "optimize"],
    L6: ["design", "create", "develop", "construct", "formulate", "propose", "build", "compose", "plan", "devise", "synthesize", "synthesise", "generate", "model", "invent"],
};
const VERB_LEVEL = {};
for (const [lvl, verbs] of Object.entries(BLOOM)) for (const v of verbs) if (!(v in VERB_LEVEL)) VERB_LEVEL[v] = lvl;
const levelOf = (v) => VERB_LEVEL[String(v || "").toLowerCase()] || null;

// verbs that cannot be assessed, and a measurable replacement for each (multi-word phrases first)
const WEAK = [
    [/\bbe\s+aware\s+of\b/i, "describe"],
    [/\bbe\s+familiar\s+with\b/i, "describe"],
    [/\bbecome\s+(?:familiar|aware)\s+(?:with|of)\b/i, "describe"],
    [/\bgain\s+(?:an?\s+)?(?:basic\s+)?knowledge\s+(?:of|about)\b/i, "describe"],
    [/\bgain\s+(?:an?\s+)?(?:basic\s+)?understanding\s+of\b/i, "explain"],
    [/\bhave\s+(?:an?\s+)?(?:basic\s+)?(?:knowledge|understanding)\s+of\b/i, "describe"],
    [/\bunderstand\b/i, "explain"],
    [/\bcomprehend\b/i, "explain"],
    [/\bgrasp\b/i, "explain"],
    [/\bappreciate\b/i, "evaluate"],
    [/\brealize\b/i, "recognize"],
    [/\bknow\b/i, "identify"],
    [/\blearn\b/i, "apply"],
    [/\bstudy\b/i, "examine"],
];
function weakIn(text) {
    for (const [re, rep] of WEAK) { const m = text.match(re); if (m) return { re, rep, word: m[0].toLowerCase() }; }
    return null;
}
const cap = (orig, rep) => (orig[0] === orig[0].toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep);

function firstVerb(text) {
    const t = String(text)
        .replace(/^(?:students?|learners?)\s+(?:will|should|shall)\s+be\s+able\s+to\s+/i, "")
        .replace(/^(?:will|should|shall|can)\s+(?:be\s+able\s+to\s+)?/i, "")
        .replace(/^to\s+/i, "");
    const m = t.match(/^([A-Za-z]+)/);
    return m ? m[1].toLowerCase() : "";
}

const SECTIONS = [
    { key: "description", label: "Course Description", sev: "Warning", re: /^(?:course\s+)?(?:description|overview|summary|introduction|rationale)\b/i },
    { key: "objectives", label: "Course Objectives", sev: "Warning", re: /^(?:course\s+)?(?:objectives?|aims?(?:\s+and\s+objectives?)?|goals?)\b/i },
    { key: "outcomes", label: "Course Outcomes", sev: "Critical", re: /^(?:course\s+|learning\s+)?(?:learning\s+)?outcomes?\b/i },
    { key: "content", label: "Course Content", sev: "Warning", re: /^(?:detailed\s+)?(?:course\s+)?(?:contents?|syllabus)\b/i },
    { key: "assessment", label: "Assessment", sev: "Warning", re: /^(?:assessment|evaluation|examination|grading|marking)\b/i },
    { key: "references", label: "References", sev: "Warning", re: /^(?:references?|text\s*books?|reference\s+books?|reading\s+list|suggested\s+reading|bibliography)\b/i },
    { key: "mapping", label: "CO–PO–PSO Mapping", sev: "Warning", re: /^(?:co[\s\-–—]*po(?:[\s\-–—]*pso)?|articulation)\b|^mapping\b/i },
    { key: "prerequisites", label: "Prerequisites", sev: "Suggestion", re: /^(?:pre[\s\-]?requisites?|requirements?)\b/i },
];

const DEFAULT_COLS = [...Array.from({ length: 12 }, (_, i) => "PO" + (i + 1)), "PSO1", "PSO2", "PSO3"];

function parseHeading(line) {
    const raw = line.trim();
    if (!raw || raw.length > 80) return null;
    const m = raw.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/);
    const title = (m ? m[2] : raw).replace(/[:：]\s*$/, "").trim();
    if (/[.;,]$/.test(title) || /\b(is|are|will|shall|can|may|should)\b/i.test(title) || title.split(/\s+/).length > 8) return null;
    return { num: m ? m[1] : null, title };
}
const isCapsHeading = (t) =>
    /^(?:\d+(?:\.\d+)*[.)]?\s+)?[A-Z][A-Z0-9 &,/\-–—:]{3,60}$/.test(t) && (t.match(/[A-Z]/g) || []).length >= 4 &&
    !/^CO\s?\d/.test(t) && !/^(?:(?:PSO|PO)\s?\d+\s*)+$/.test(t);

/* ======================= 3. The checks ======================= */
function analyze(rawText, meta = {}) {
    const text = String(rawText || "").replace(/\r\n?/g, "\n");
    const hasPages = text.includes("\f");
    const breaks = []; for (let i = text.indexOf("\f"); i !== -1; i = text.indexOf("\f", i + 1)) breaks.push(i);
    const pageAt = (off) => { let n = 1; for (const b of breaks) { if (b < off) n++; else break; } return n; };

    const lines = []; let off = 0;
    for (const l of text.split("\n")) { lines.push({ t: l.replace(/\f/g, "").replace(/\s+/g, " ").trim(), off }); off += l.length + 1; }
    const lineAt = (o) => { let k = 0; for (let i = 0; i < lines.length; i++) { if (lines[i].off <= o) k = i; else break; } return k; };
    const clip = (s, n = 180) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

    // --- find sections
    const heads = [];
    lines.forEach((ln, i) => {
        const h = parseHeading(ln.t); if (!h) return;
        const s = SECTIONS.find((x) => x.re.test(h.title));
        if (s) heads.push({ key: s.key, i, num: h.num });
    });
    const capsAt = lines.map((ln) => isCapsHeading(ln.t));
    const headIdx = new Set(heads.map((h) => h.i));
    const isBoundary = (i) => capsAt[i] || headIdx.has(i);
    const sec = {};
    for (const h of heads) { // keep the occurrence with the longest body (skips table-of-contents lines)
        let end = h.i + 1; while (end < lines.length && !isBoundary(end)) end++;
        const len = end - h.i;
        if (!sec[h.key] || len > sec[h.key].len) sec[h.key] = { ...h, end, len };
    }
    const body = (key) => (sec[key] ? lines.slice(sec[key].i + 1, sec[key].end) : []);
    const labelOf = (key) => SECTIONS.find((s) => s.key === key).label;

    // --- finding helpers
    const findings = []; let checks = 0;
    const loc = (key, i) => {
        const parts = [];
        if (key && sec[key]?.num) parts.push("Section " + sec[key].num);
        parts.push(key ? labelOf(key) : "Document");
        let page = null;
        if (hasPages && i !== undefined && lines[i]) { page = pageAt(lines[i].off); parts.push("Page " + page); }
        return { where: parts.join(" · "), page };
    };
    const add = (severity, title, detail, original, suggestion, where, extra = {}) =>
        findings.push({ severity, title, detail, original, suggestion, where: where.where, page: where.page, ...extra });

    // --- 1. required sections
    for (const s of SECTIONS) {
        checks++;
        if (!sec[s.key]) add(s.sev, `${s.label} section is missing`, `No “${s.label}” heading was found in the document.`, "Not found in the document", `Add a “${s.label}” section.`, { where: "Document structure", page: null });
        else if (!body(s.key).some((l) => l.t)) add("Warning", `${s.label} section is empty`, `The “${s.label}” heading has no content under it.`, "(empty)", `Add the ${s.label.toLowerCase()} content.`, loc(s.key, sec[s.key].i));
    }

    // --- 2. course outcomes
    const outcomes = [];
    if (sec.outcomes) {
        let cur = null;
        for (let i = sec.outcomes.i + 1; i < sec.outcomes.end; i++) {
            const t = lines[i].t; if (!t) continue;
            const m = t.match(/^CO\s*[-.]?\s*(\d+)\s*[:.\-–—)]?\s*(.*)$/i);
            if (m) { cur = { id: "CO" + m[1], text: m[2].trim(), line: i }; outcomes.push(cur); continue; }
            if (cur && !/^(?:bloom|level)\b/i.test(t) && !/[.;]$/.test(cur.text) && !isCapsHeading(t)) cur.text = (cur.text + " " + t).trim();
        }
        if (!outcomes.length) { // fall back to a plain numbered / bulleted list
            for (let i = sec.outcomes.i + 1; i < sec.outcomes.end; i++) {
                const m = lines[i].t.match(/^(?:\d+[.)]|[•\-–*])\s+(.{8,})$/);
                if (m) outcomes.push({ id: "CO" + (outcomes.length + 1), text: m[1].trim(), line: i });
            }
        }
        for (const o of outcomes) {
            const bm = o.text.match(/(?:\bbloom'?s?\s*(?:level)?\s*[:\-]?\s*)?\bL\s?([1-6])\b\s*$/i);
            if (bm) { o.bloomDoc = "L" + bm[1]; o.text = o.text.slice(0, bm.index).trim(); }
            o.verbLevel = levelOf(firstVerb(o.text));
            o.bloom = o.bloomDoc || o.verbLevel || "—";
        }
        checks++;
        if (!outcomes.length) add("Warning", "Course outcomes could not be read", "No lines like “CO1: …” were found under the outcomes heading.", "(no outcomes found)", "Write each outcome on its own line starting with CO1, CO2, …", loc("outcomes", sec.outcomes.i));
    }
    for (const o of outcomes) { // measurable verbs
        checks++;
        const w = weakIn(o.text); if (!w) continue;
        const fixed = o.text.replace(w.re, (m) => cap(m, w.rep));
        add("Critical", `Course outcome ${o.id} is not measurable`,
            `The verb “${w.word}” cannot be assessed objectively. Replace it with an observable action verb aligned to Bloom’s taxonomy.`,
            `${o.id}: ${o.text}`, `${o.id}: ${fixed}`, loc("outcomes", o.line),
            { outcome: { co: o.id, text: fixed, bloom: levelOf(w.rep) || o.bloom } });
    }
    checks++;
    if (outcomes.length && outcomes.length < 3) add("Warning", "Very few course outcomes", `Only ${outcomes.length} outcome${outcomes.length === 1 ? "" : "s"} found. Most programmes expect 3–6.`, `${outcomes.length} outcome(s)`, "Add outcomes that cover the main topics and skills of the course.", loc("outcomes", sec.outcomes.i));
    else if (outcomes.length > 8) add("Suggestion", "Many course outcomes", `${outcomes.length} outcomes were found. Large lists are hard to assess; 3–6 is typical.`, `${outcomes.length} outcomes`, "Merge related outcomes.", loc("outcomes", sec.outcomes.i));
    checks++;
    const known = outcomes.filter((o) => o.bloom !== "—").map((o) => +o.bloom[1]);
    if (outcomes.length >= 3 && known.length === outcomes.length && Math.max(...known) <= 2)
        add("Suggestion", "All outcomes are at low Bloom levels", "Every outcome is at Remember/Understand level. Most degree courses include higher-order outcomes (apply, analyse, evaluate, create).", outcomes.map((o) => `${o.id} ${o.bloom}`).join(", "), "Raise at least one or two outcomes to Apply level or above.", loc("outcomes", sec.outcomes.i));
    checks++;
    const mism = outcomes.filter((o) => o.bloomDoc && o.verbLevel && o.bloomDoc !== o.verbLevel);
    if (mism.length) add("Suggestion", "Stated Bloom levels do not match the verbs",
        `For ${mism.slice(0, 5).map((o) => `${o.id} (stated ${o.bloomDoc}, verb suggests ${o.verbLevel})`).join(", ")}.`,
        mism.slice(0, 3).map((o) => `${o.id}: ${o.bloomDoc}`).join(" · "), mism.slice(0, 3).map((o) => `${o.id}: ${o.verbLevel}`).join(" · "), loc("outcomes", mism[0].line));

    // --- 3. contact hours vs unit hours
    const cLines = sec.content ? lines.slice(sec.content.i + 1, sec.content.end) : lines;
    const cBase = sec.content ? sec.content.i + 1 : 0;
    const lastHours = (s) => { const all = [...s.matchAll(/(\d{1,3})\s*(?:hours?|hrs?\.?|h\b|lectures?|periods?)/gi)]; return all.length ? +all[all.length - 1][1] : null; };
    const units = [];
    for (let k = 0; k < cLines.length; k++) {
        const um = cLines[k].t.match(/^(?:unit|module|chapter)\s*[-–:.]?\s*([ivx]+|\d+)\b(.*)$/i); if (!um) continue;
        let h = lastHours(um[2]);
        if (h == null && cLines[k + 1]) { const nx = cLines[k + 1].t.match(/^[(\[]?\s*(\d{1,3})\s*(?:hours?|hrs?\.?|h|lectures?|periods?)\b/i); if (nx) h = +nx[1]; }
        if (h != null) units.push({ hours: h, line: cBase + k, text: cLines[k].t });
    }
    let declared = null;
    for (const re of [/contact\s+hours?\s*(?:per\s+semester)?\s*[:\-–=(]?\s*(\d{1,3})\b/i, /\b(\d{1,3})\s*contact\s+hours?\b/i, /total\s+(?:lecture\s+|teaching\s+)?(?:hours?|periods?)\s*[:\-–=(]?\s*(\d{1,3})\b/i]) {
        const m = text.match(re); if (m) { declared = +m[1]; break; }
    }
    checks++;
    if (units.length >= 2 && declared) {
        const sum = units.reduce((n, u) => n + u.hours, 0);
        if (sum !== declared) {
            const last = units[units.length - 1], want = last.hours + (declared - sum);
            const fix = want > 0 ? last.text.replace(new RegExp(`\\b${last.hours}(\\s*(?:hours?|hrs?\\.?|h\\b|lectures?|periods?))`, "i"), `${want}$1`) : null;
            add("Warning", "Lecture hours do not reconcile", `Unit-wise lecture hours total ${sum}, while the course structure declares ${declared} contact hours.`,
                clip(last.text), fix && fix !== last.text ? clip(fix) : `Adjust the unit hours so they total ${declared}.`, loc(sec.content ? "content" : null, last.line));
        }
    }

    // --- 4. assessment weightage
    checks++;
    if (sec.assessment) {
        const idx = []; for (let i = sec.assessment.i + 1; i < sec.assessment.end; i++) if (/\d\s*%/.test(lines[i].t) && !/\btotal\b/i.test(lines[i].t)) idx.push(i);
        const nums = idx.flatMap((i) => [...lines[i].t.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((m) => +m[1]));
        const sum = nums.reduce((a, b) => a + b, 0);
        if (nums.length >= 2 && nums.length <= 8 && Math.abs(sum - 100) > 0.01)
            add("Warning", "Assessment weightage does not total 100%",
                `The assessment weightages add up to ${+sum.toFixed(1)}%. They should total 100%.${sum > 100 ? " If some of these are sub-components of a larger item, reject this finding." : ""}`,
                clip(idx.slice(0, 2).map((i) => lines[i].t).join(" · ")), `Adjust the weightages so they total 100% (currently ${+sum.toFixed(1)}%).`, loc("assessment", idx[0]));
    }

    // --- 5. details entered in the form vs the document
    if (meta.code) {
        const canon = String(meta.code).replace(/\s|-/g, "").toUpperCase();
        const cm = canon.match(/^([A-Z]+)(\d+)$/);
        if (cm) {
            const re = new RegExp(`\\b${cm[1]}[\\s\\-]?${cm[2]}\\b`, "gi");
            const found = [...text.matchAll(re)];
            checks += 2;
            if (!found.length) add("Warning", "Course code not found in the document", `The code ${canon} entered in the form does not appear anywhere in the document.`, "Not found in the document", `Check the code, or add “${canon}” to the document header.`, { where: "Document header", page: null });
            else {
                const variant = found.find((m) => m[0] !== canon);
                if (variant) {
                    const i = lineAt(variant.index);
                    add("Suggestion", "Inconsistent course code format", `The course code is written in more than one way (for example “${variant[0].replace(/\s+/g, " ")}” and “${canon}”).`,
                        clip(lines[i].t), clip(lines[i].t.replace(new RegExp(`\\b${cm[1]}[\\s\\-]?${cm[2]}\\b`, "i"), canon)), loc(null, i));
                }
            }
        }
    }
    if (meta.title) {
        checks++;
        const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!norm(text).includes(norm(meta.title)))
            add("Warning", "Course title does not match the document", `The title “${meta.title}” entered in the form was not found in the document.`, meta.title, "Correct the title in the form, or fix the title in the document.", { where: "Document header", page: null });
    }
    if (meta.credits) {
        checks++;
        const cr = text.match(/credits?\s*[:\-–=]?\s*(\d{1,2})\b/i) || text.match(/\b(\d{1,2})\s*credits?\b/i);
        if (cr && +cr[1] !== +meta.credits)
            add("Warning", "Credits do not match", `The document says ${cr[1]} credits but the form says ${meta.credits}.`, `${cr[1]} credits`, `${meta.credits} credits`, loc(null, lineAt(cr.index)));
    }

    // --- 6. language and consistency
    checks++;
    const reps = [];
    lines.forEach((ln, i) => { const m = ln.t.match(/\b([A-Za-z]{3,})\s+\1\b/i); if (m && !/^(?:that|had)$/i.test(m[1])) reps.push({ i, t: ln.t }); });
    if (reps.length) add("Suggestion", "Repeated words", `A word is repeated in ${reps.length} place${reps.length === 1 ? "" : "s"}.`, clip(reps[0].t), clip(reps[0].t.replace(/\b([A-Za-z]{3,})\s+\1\b/gi, "$1")), loc(null, reps[0].i));
    checks++;
    const PAIRS = [[/\banalys(?:e|ed|es|ing)\b/i, /\banalyz(?:e|ed|es|ing)\b/i], [/\borganis(?:e|ed|ation|ations)\b/i, /\borganiz(?:e|ed|ation|ations)\b/i], [/\boptimis(?:e|ed|ation)\b/i, /\boptimiz(?:e|ed|ation)\b/i], [/\bbehaviour\b/i, /\bbehavior\b/i], [/\bcentre\b/i, /\bcenter\b/i]];
    const mixed = PAIRS.filter(([uk, us]) => uk.test(text) && us.test(text));
    if (mixed.length) {
        const m = text.match(mixed[0][0]);
        add("Suggestion", "Mixed British and American spelling", "Both spelling styles are used, for example " + mixed.slice(0, 3).map(([uk, us]) => `“${text.match(uk)[0]}” and “${text.match(us)[0]}”`).join(", ") + ".",
            clip(lines[lineAt(m.index)].t), "Use one spelling style throughout the document.", loc(null, lineAt(m.index)));
    }
    checks++;
    const ph = text.match(/\b(?:TBD|TODO|lorem ipsum|to be decided|to be added|xxx+)\b|\[(?:insert|enter|add)[^\]]*\]/i);
    if (ph) add("Warning", "Placeholder text left in the document", `Found “${ph[0]}”, which looks like unfinished text.`, clip(lines[lineAt(ph.index)].t), "Replace the placeholder with the final content.", loc(null, lineAt(ph.index)));

    // --- 7. CO-PO-PSO mapping table
    let cols = null, rows = [];
    for (let i = sec.mapping ? sec.mapping.i : 0; i < lines.length && !rows.length; i++) {
        const hs = [...lines[i].t.matchAll(/\b(PSO|PO)\s?(\d{1,2})\b/gi)]; if (hs.length < 3) continue;
        const names = hs.map((m) => m[1].toUpperCase() + +m[2]), got = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
            const rm = lines[j].t.match(/^CO\s*-?(\d+)\s+(.*)$/i); if (!rm) continue;
            const toks = rm[2].trim().split(/\s+/);
            if (toks.length === names.length && toks.every((x) => /^[0-3]$|^[-–—]$/.test(x))) got.push({ id: "CO" + rm[1], vals: toks.map((x) => (/^[0-3]$/.test(x) ? +x : 0)) });
        }
        if (got.length) { cols = names; rows = got; }
    }
    checks += 2;
    if (!rows.length && sec.mapping) add("Warning", "CO–PO–PSO mapping could not be read", "No table of CO rows with PO/PSO columns was found under the mapping heading.", "(no readable mapping table)", "Add a table with one row per CO and one column per PO/PSO, using 0–3 (or “–”) in each cell.", loc("mapping", sec.mapping.i));
    if (rows.length && outcomes.length) {
        const missing = outcomes.filter((o) => !rows.some((r) => r.id === o.id)).map((o) => o.id);
        if (missing.length) add("Warning", "Mapping is missing some outcomes", `The mapping table has no row for ${missing.join(", ")}.`, `${rows.length} of ${outcomes.length} outcomes mapped`, `Add rows for ${missing.join(", ")}.`, loc("mapping", sec.mapping ? sec.mapping.i : undefined));
        const empty = outcomes.filter((o) => { const r = rows.find((x) => x.id === o.id); return r && r.vals.every((v) => v === 0); }).map((o) => o.id);
        if (empty.length) add("Warning", "Outcome has no mapping", `${empty.join(", ")} ${empty.length === 1 ? "is" : "are"} not mapped to any program outcome.`, empty.join(", "), "Map each outcome to at least one PO or PSO.", loc("mapping", sec.mapping ? sec.mapping.i : undefined));
    }
    cols = cols || DEFAULT_COLS;
    const matrix = outcomes.map((o) => { const r = rows.find((x) => x.id === o.id); return r ? r.vals : cols.map(() => 0); });

    // --- extras used in the preview
    const description = body("description").map((l) => l.t).filter(Boolean).join(" ").slice(0, 600) || null;
    const lt = text.match(/L\s*[-–—]\s*T\s*[-–—]\s*P[^0-9]{0,20}(\d+)\s*[-–—]\s*(\d+)\s*[-–—]\s*(\d+)/i);

    // --- order, number and score
    const rank = { Critical: 0, Warning: 1, Suggestion: 2 };
    findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
    findings.forEach((f, i) => (f.id = i + 1));
    const base = Math.max(0, 100 - findings.reduce((n, f) => n + PENALTY[f.severity], 0));
    return {
        findings, base, totalChecks: checks, cols, matrix, description, ltp: lt ? `${lt[1]}–${lt[2]}–${lt[3]}` : null,
        outcomes: outcomes.map((o) => ({ id: o.id, text: o.text, bloom: o.bloom })),
    };
}

/* ======================= 4. Starting-point mapping (no AI) ======================= */
const PO_RULES = [
    [/\b(analy[sz]|compar|examin|differentiat|diagnos|solv)/, { 1: 3, 2: 3 }],
    [/\b(investigat|experiment|evaluat|assess|justif|validat|test)/, { 2: 2, 4: 3 }],
    [/\b(design|develop|creat|construct|formulat|propos|build|devis|architect)/, { 3: 3, 1: 2 }],
    [/\b(implement|code|coding|program|simulat|software|tool|use|apply|applied)/, { 5: 3, 1: 3 }],
    [/\b(team|group|collaborat|lead)/, { 9: 3 }],
    [/\b(communicat|present|report|document|write|explain)/, { 10: 2 }],
    [/\b(ethic|professional|responsib|integrity)/, { 8: 3 }],
    [/\b(societ|social|safety|health|public)/, { 6: 2 }],
    [/\b(environment|sustainab)/, { 7: 2 }],
    [/\b(cost|manag|project|econom|financ)/, { 11: 2 }],
    [/\b(self[-\s]?learn|lifelong|life-long|independent|research|latest|emerging)/, { 12: 3, 4: 2 }],
];
function suggestMapping(outcomes, cols) {
    return outcomes.map((o) => {
        const t = o.text.toLowerCase(), w = { 1: 2 };
        for (const [re, add] of PO_RULES) if (re.test(t)) for (const [po, v] of Object.entries(add)) w[po] = Math.max(w[po] || 0, v);
        return cols.map((c) => {
            const m = c.match(/^(PSO|PO)(\d+)$/); if (!m) return 0;
            if (m[1] === "PO") return w[+m[2]] || 0;
            if (m[2] === "1") return /\b(implement|develop|design|software|program|code|build)/.test(t) ? 2 : 0;
            if (m[2] === "2") return /\b(analy[sz]|evaluat|research|investigat)/.test(t) ? 2 : 0;
            return 0;
        });
    });
}

/* ======================= 5. Optional Claude layer ======================= */
const hasAI = () => !!process.env.ANTHROPIC_API_KEY;
async function askClaude(prompt, maxTokens = 2000) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error("AI request failed (" + res.status + ")");
    const data = await res.json();
    const out = (data.content || []).map((b) => b.text || "").join("");
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI reply was not JSON");
    return JSON.parse(m[0]);
}

// Rewrites the non-measurable outcomes more naturally than the verb swap. Returns true if anything changed.
async function aiPolish(result) {
    const weak = result.findings.filter((f) => f.outcome);
    if (!weak.length) return false;
    const payload = weak.map((f) => ({ id: f.outcome.co, outcome: f.original.replace(/^CO\s*\d+\s*[:.\-–—)]?\s*/i, "") }));
    const out = await askClaude(`You review university course outcomes. Rewrite each outcome so it starts with ONE observable Bloom's-taxonomy action verb, keeping the original meaning and subject. Do not add new content. Reply with ONLY a JSON object that maps each id to the rewritten sentence (without the id prefix).\n\n${JSON.stringify(payload)}`);
    let n = 0;
    for (const f of weak) {
        const r = out && out[f.outcome.co];
        if (typeof r === "string" && r.trim().length > 8 && r.length < 300) {
            f.outcome.text = r.trim(); f.outcome.bloom = levelOf(firstVerb(r)) || f.outcome.bloom; f.suggestion = `${f.outcome.co}: ${r.trim()}`; n++;
        }
    }
    return n > 0;
}

async function aiSuggestMapping(outcomes, cols) {
    const out = await askClaude(`Map each course outcome to the program outcomes. Use 0 (none), 1 (low), 2 (medium) or 3 (high), only for direct, assessable relationships. Standard PO meanings: PO1 engineering knowledge, PO2 problem analysis, PO3 design of solutions, PO4 investigation of complex problems, PO5 modern tool usage, PO6 engineer and society, PO7 environment and sustainability, PO8 ethics, PO9 teamwork, PO10 communication, PO11 project management, PO12 lifelong learning. PSO columns are program-specific, so give them 0 unless the outcome clearly supports them.\nColumns in order: ${JSON.stringify(cols)}\nOutcomes: ${JSON.stringify(outcomes.map((o) => ({ id: o.id, text: o.text })))}\nReply with ONLY JSON: {"matrix": [[...one number per column...], ...one row per outcome in order]}`, 2500);
    const mx = out && out.matrix;
    const ok = Array.isArray(mx) && mx.length === outcomes.length && mx.every((r) => Array.isArray(r) && r.length === cols.length && r.every((v) => [0, 1, 2, 3].includes(v)));
    if (!ok) throw new Error("AI returned an invalid matrix");
    return mx;
}

module.exports = { PENALTY, extractText, analyze, suggestMapping, hasAI, aiPolish, aiSuggestMapping, levelOf, firstVerb };