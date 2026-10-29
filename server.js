const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const cookieParser = require("cookie-parser");
const db = require("./db");
const { createAuth, requireAuth } = require("./auth");
const audit = require("./audit");
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* ---------- Seed / mock data ---------- */
const OUTCOMES = [
    { id: "CO1", text: "Analyze the efficiency of fundamental data structures and algorithms.", bloom: "L4" },
    { id: "CO2", text: "Implement linear and non-linear data structures for computational problems.", bloom: "L3" },
    { id: "CO3", text: "Understand appropriate algorithmic strategies for real-world constraints.", bloom: "L2" },
    { id: "CO4", text: "Evaluate algorithm performance using asymptotic analysis.", bloom: "L5" },
    { id: "CO5", text: "Design efficient solutions using graphs, trees, and hashing techniques.", bloom: "L6" },
];
const COLS = ["PO1", "PO2", "PO3", "PO4", "PO5", "PO12", "PSO1", "PSO2"];
const MATRIX = [[3, 3, 2, 1, 2, 1, 3, 2], [3, 2, 3, 1, 3, 0, 3, 2], [2, 3, 2, 2, 2, 1, 2, 3], [3, 3, 1, 3, 2, 2, 2, 2], [3, 2, 3, 2, 3, 1, 3, 3]];
const AI_MATRIX = [[3, 3, 2, 1, 2, 1, 3, 2], [3, 2, 3, 1, 3, 1, 3, 2], [2, 3, 2, 2, 2, 1, 2, 3], [3, 3, 1, 2, 2, 2, 2, 2], [3, 2, 3, 2, 3, 1, 3, 3]];
const FINDINGS = [
    {
        id: 1, severity: "Critical", title: "Course outcome CO3 is not measurable", where: "Section 4.2 · Course Outcomes · Page 3",
        detail: "The verb “understand” cannot be assessed objectively. Replace it with an observable action verb aligned to Bloom’s taxonomy.",
        original: "CO3: Understand appropriate algorithmic strategies for real-world constraints.",
        suggestion: "CO3: Select appropriate algorithmic strategies for real-world constraints.", outcome: { co: "CO3", text: "Select appropriate algorithmic strategies for real-world constraints.", bloom: "L3" }
    },
    {
        id: 2, severity: "Warning", title: "Lecture hours do not reconcile", where: "Section 5.1 · Course Content · Page 4",
        detail: "Unit-wise lecture hours total 43, while the course structure declares 45 contact hours.",
        original: "Unit V: Hashing and Graph Algorithms (7 hours)", suggestion: "Unit V: Hashing and Graph Algorithms (9 hours)"
    },
    {
        id: 3, severity: "Warning", title: "Assessment weightage is incomplete", where: "Section 7 · Assessment · Page 6",
        detail: "Internal and end-semester weightages add up to 90%. They should total 100%.",
        original: "Continuous assessment 40% · End-semester examination 50%", suggestion: "Continuous assessment 50% · End-semester examination 50%"
    },
    {
        id: 4, severity: "Suggestion", title: "Inconsistent course code format", where: "Section 1 · Header · Page 1",
        detail: "The course code appears as “CS 201” in the header and “CS201” in the table.",
        original: "Course Code: CS 201", suggestion: "Course Code: CS201"
    },
];
const WEIGHT = audit.PENALTY; // points lost per finding, regained when it is accepted
// older saved audits may not have these fields, so fall back to the sample values
const OUT = (a) => a.outcomes || OUTCOMES;
const COL = (a) => a.cols || COLS;

function makeAudit(d, base, status, hoursAgo) {
    return {
        id: d.code.toLowerCase(), ...d, base, status, file: d.file || null,
        updated: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
        findings: JSON.parse(JSON.stringify(FINDINGS)), decisions: {}, edits: {},
        matrix: MATRIX.map((r) => [...r]),
        just: { "CO2-PO2": "Students analyze complex computational problems and select suitable data structures to implement.", "CO1-PSO1": "Efficiency analysis directly supports the program’s core computing specialization." }
    };
}
function seed() {
    const p = { program: "B.Tech. Computer Science", year: "2025–26", semester: "Semester 3", credits: 4 };
    return [
        makeAudit({ ...p, code: "CS201", title: "Data Structures and Algorithms" }, 91, "Ready to export", 1),
        makeAudit({ ...p, code: "CS305", title: "Database Management Systems" }, 76, "Needs review", 27),
        makeAudit({ ...p, code: "EC204", title: "Digital Signal Processing", program: "B.Tech. Electronics" }, 88, "Audit complete", 120),
        makeAudit({ ...p, code: "ME102", title: "Engineering Mechanics", program: "B.Tech. Mechanical" }, 64, "Issues found", 170),
    ];
}
const save = () => { }; // kept so old save() calls don't break; saving is automatic now

/* ---------- Helpers ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const open = (a) => a.findings.filter((f) => !a.decisions[f.id] || a.decisions[f.id] === "rejected" && false);
const unresolved = (a) => a.findings.filter((f) => !a.decisions[f.id]);
const score = (a) => Math.min(100, a.base + a.findings.filter((f) => a.decisions[f.id] === "accepted").reduce((n, f) => n + WEIGHT[f.severity], 0));
function summary(a) {
    const u = unresolved(a);
    return {
        id: a.id, code: a.code, title: a.title, program: a.program, year: a.year, semester: a.semester, credits: a.credits,
        updated: a.updated, status: a.status, score: score(a),
        counts: { critical: u.filter((f) => f.severity === "Critical").length, warning: u.filter((f) => f.severity === "Warning").length, suggestion: u.filter((f) => f.severity === "Suggestion").length, passed: Math.max(0, (a.totalChecks ?? 42) - a.findings.length) }
    };
}
function validations(a) {
    const out = [], outs = OUT(a), cols = COL(a), lim = Math.max(5, Math.ceil(cols.length * 0.6));
    a.matrix.forEach((row, i) => { const n = row.filter((v) => v === 3).length; if (n >= lim && outs[i]) out.push(`${outs[i].id} has ${n} strong mappings`); });
    cols.forEach((c, j) => {
        if (c.startsWith("PSO") && a.matrix.some((r) => r[j] === 3) && !Object.keys(a.just).some((k) => k.endsWith("-" + c) && a.just[k].trim()))
            out.push(`${c} justification is missing`);
    });
    return out;
}
// the outcomes as they will appear in the corrected document: accepted fixes are applied
function outcomesFor(a) {
    return OUT(a).map((o) => {
        const f = a.findings.find((x) => x.outcome && x.outcome.co === o.id && a.decisions[x.id] === "accepted");
        if (!f) return o;
        const txt = (a.edits[f.id] || f.outcome.text).replace(/^CO\s*\d+\s*[:.\-–—)]?\s*/i, "");
        return { ...o, text: txt, bloom: f.outcome.bloom || o.bloom };
    });
}
function docFragment(a) {
    const th = (t) => `<th>${t}</th>`;
    const outs = outcomesFor(a), cols = COL(a);
    const desc = a.description === undefined ? "This course develops foundational knowledge of data organization, algorithm design, and computational efficiency. Students learn to analyze, implement, and evaluate linear and non-linear data structures for solving complex problems." : a.description || "Course description not provided.";
    const ltp = a.ltp === undefined ? "3–0–2" : a.ltp || "—";
    return `<div class="doc"><div class="doc-head"><div class="crest">🎓</div><div><h2>NORTHBRIDGE UNIVERSITY</h2><p>School of Computing and Informatics</p><em>Excellence through knowledge and innovation</em></div></div><hr class="dbl">
  <h1>COURSE SPECIFICATION</h1><p class="c">Academic Year ${esc(a.year)}</p>
  <table><tr>${th("COURSE TITLE")}<td>${esc(a.title)}</td>${th("COURSE CODE")}<td>${esc(a.code)}</td></tr>
  <tr>${th("PROGRAM")}<td>${esc(a.program)}</td>${th("SEMESTER")}<td>${esc(a.semester)}</td></tr>
  <tr>${th("CREDITS")}<td>${esc(a.credits)}</td>${th("L–T–P")}<td>${esc(ltp)}</td></tr></table>
  <h3>1. COURSE DESCRIPTION</h3><p>${esc(desc)}</p>
  <h3>2. COURSE OUTCOMES</h3><p>Upon successful completion of this course, students will be able to:</p>
  <table>${outs.map((o) => `<tr><td><b>${esc(o.id)}</b></td><td>${esc(o.text)}</td><td class="c">${o.bloom && o.bloom !== "—" ? "Bloom " + esc(o.bloom) : ""}</td></tr>`).join("")}</table>
  <h3>3. CO–PO–PSO MAPPING</h3><table class="c"><tr><th></th>${cols.map(th).join("")}</tr>
  ${a.matrix.map((r, i) => `<tr><td><b>${esc(outs[i] ? outs[i].id : "")}</b></td>${r.map((v) => `<td>${v || "–"}</td>`).join("")}</tr>`).join("")}</table></div>`;
}
const DOC_CSS = `body{font-family:Georgia,serif;max-width:760px;margin:30px auto;padding:0 20px;color:#18181b;font-size:13px}table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border:1px solid #888;padding:6px;text-align:left}th{background:#f4f4f4;font-size:11px}.c,.c td,.c th{text-align:center}h1{text-align:center;letter-spacing:3px;color:#1f2a5a;font-size:22px}h2{margin:0;color:#1f2a5a;letter-spacing:2px}h3{border-bottom:1px solid #000;color:#1f2a5a;margin-top:24px}.doc-head{display:flex;gap:16px;align-items:center}.crest{font-size:28px;border:2px solid #1f2a5a;border-radius:50%;width:54px;height:54px;display:grid;place-items:center}hr.dbl{border:0;border-top:4px double #1f2a5a;margin:18px 0}p{margin:4px 0}`;

const auth = createAuth({ onUserCreated: (uid) => seed().forEach((a) => db.saveAudit(uid, a)) });
app.use("/api/auth", auth.router);
app.use("/api", requireAuth); // every route below this line now requires login
auth.ensureDemoUser();

/* ---------- API ---------- */

const find = (req, res, next) => {
    const a = db.getAudit(req.user.id, req.params.id);
    if (!a) return res.status(404).json({ error: "Audit not found" });
    req.audit = a;
    if (req.method !== "GET") res.on("finish", () => { if (res.statusCode < 400) db.saveAudit(req.user.id, req.audit); });
    next();
};

app.get("/api/audits", (req, res) => res.json(db.listAudits(req.user.id).sort((a, b) => b.updated.localeCompare(a.updated)).map(summary)));

app.get("/api/stats", (req, res) => {
    const s = db.listAudits(req.user.id).map(summary);
    res.json({
        audited: 120 + s.length, compliance: s.length ? +(s.reduce((n, x) => n + x.score, 0) / s.length).toFixed(1) : 0,
        openFindings: s.reduce((n, x) => n + x.counts.critical + x.counts.warning + x.counts.suggestion, 0),
        needAttention: s.reduce((n, x) => n + x.counts.critical, 0), hoursSaved: 40 + s.length * 1.5
    });
});

app.get("/api/templates", (req, res) => res.json([
    { name: "Northbridge Standard Course Specification", meta: "DOCX · 18 required sections · Default", used: 124 },
    { name: "Outcome-Based Education (OBE) Format", meta: "PDF · 15 required sections", used: 41 },
    { name: "Lab Course Specification", meta: "DOCX · 14 required sections", used: 17 },
]));

const upload = multer({
    dest: path.join(__dirname, "uploads"), limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => (/\.(pdf|docx)$/i.test(file.originalname) ? cb(null, true) : cb(new Error("Only PDF or DOCX files are allowed"))),
});

app.post("/api/audits", upload.single("file"), async (req, res) => {
    const { title, code, program, year, semester } = req.body;
    const credits = Number(req.body.credits);
    const reject = (status, error) => { if (req.file) fs.unlink(req.file.path, () => { }); return res.status(status).json({ error }); };
    if (!req.file) return res.status(400).json({ error: "Please upload a PDF or DOCX file" });
    if (!title?.trim() || !/^[A-Za-z]{2,4}\s?\d{2,4}$/.test((code || "").trim())) return reject(400, "Enter a valid title and course code (e.g. CS201)");
    if (!Number.isInteger(credits) || credits < 1 || credits > 10) return reject(400, "Credits must be between 1 and 10");
    const cleanCode = code.replace(/\s/g, "").toUpperCase();
    try {
        // 1. read the file  2. run the checks  3. (optional) let Claude polish the rewrites
        const ext = path.extname(req.file.originalname).toLowerCase();
        const { text, pages } = await audit.extractText(req.file.path, ext);
        const r = audit.analyze(text, { title: title.trim(), code: cleanCode, credits });
        let aiUsed = false;
        if (audit.hasAI()) { try { aiUsed = await audit.aiPolish(r); } catch (e) { console.warn("AI step skipped:", e.message); } }

        const crit = r.findings.filter((f) => f.severity === "Critical").length, warn = r.findings.filter((f) => f.severity === "Warning").length;
        const a = makeAudit({ title: title.trim(), code: cleanCode, program, year, semester, credits, file: req.file.originalname }, r.base,
            crit ? "Issues found" : warn ? "Needs review" : "Ready to export", 0);
        Object.assign(a, {
            findings: r.findings, outcomes: r.outcomes, cols: r.cols, matrix: r.matrix, just: {}, description: r.description, ltp: r.ltp,
            totalChecks: r.totalChecks, pages, ai: aiUsed, fileType: ext === ".pdf" ? "pdf" : "docx",
            upload: path.basename(req.file.path), text: ext === ".pdf" ? null : text,
        });
        const old = db.getAudit(req.user.id, a.id); // same course code = same id, so a re-upload replaces the old audit
        if (old && old.upload) fs.unlink(path.join(__dirname, "uploads", path.basename(old.upload)), () => { });
        db.saveAudit(req.user.id, a);
        res.status(201).json(summary(a));
    } catch (e) {
        console.error("Audit failed:", e);
        reject(422, e.message || "Could not read this file");
    }
});

app.get("/api/audits/:id", find, (req, res) => {
    const a = req.audit;
    res.json({
        ...summary(a), file: a.file || `${a.code}_Course_Specification_2025.pdf`, pages: a.pages ?? 9, fileType: a.fileType || null, ai: !!a.ai,
        text: a.fileType === "docx" ? a.text : undefined,
        findings: a.findings.map((f) => ({ ...f, decision: a.decisions[f.id] || null, suggestion: a.edits[f.id] ?? f.suggestion })), doc: docFragment(a)
    });
});

// the original uploaded PDF, shown in the viewer (only for the signed-in owner, because of `find`)
app.get("/api/audits/:id/file", find, (req, res) => {
    const a = req.audit;
    if (a.fileType !== "pdf" || !a.upload) return res.status(404).json({ error: "No PDF stored for this audit" });
    const p = path.join(__dirname, "uploads", path.basename(a.upload));
    if (!fs.existsSync(p)) return res.status(404).json({ error: "The uploaded file is no longer on the server" });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": "inline" });
    res.sendFile(p);
});

app.patch("/api/audits/:id/findings/:fid", find, (req, res) => {
    const a = req.audit, fid = Number(req.params.fid), f = a.findings.find((x) => x.id === fid);
    if (!f) return res.status(404).json({ error: "Finding not found" });
    const { decision, text } = req.body;
    if (decision !== undefined && !["accepted", "rejected", null].includes(decision)) return res.status(400).json({ error: "Invalid decision" });
    if (typeof text === "string") a.edits[fid] = text.slice(0, 500);
    if (decision !== undefined) decision ? (a.decisions[fid] = decision) : delete a.decisions[fid];
    if (!a.findings.some((x) => x.severity === "Critical" && !a.decisions[x.id])) a.status = "Ready to export";
    a.updated = new Date().toISOString(); save(); res.json(summary(a));
});

app.post("/api/audits/:id/findings/accept-all", find, (req, res) => {
    req.audit.findings.forEach((f) => (req.audit.decisions[f.id] = "accepted"));
    req.audit.status = "Ready to export"; req.audit.updated = new Date().toISOString(); save(); res.json(summary(req.audit));
});

app.get("/api/audits/:id/mapping", find, (req, res) => {
    const a = req.audit;
    res.json({ outcomes: outcomesFor(a), cols: COL(a), matrix: a.matrix, just: a.just, validations: validations(a) });
});
app.put("/api/audits/:id/mapping", find, (req, res) => {
    const { matrix, just } = req.body, rows = OUT(req.audit).length, cols = COL(req.audit).length;
    const ok = Array.isArray(matrix) && matrix.length === rows && matrix.every((r) => Array.isArray(r) && r.length === cols && r.every((v) => [0, 1, 2, 3].includes(v)));
    if (!ok) return res.status(400).json({ error: `Matrix must be ${rows}×${cols} with values 0–3` });
    req.audit.matrix = matrix;
    if (just && typeof just === "object") req.audit.just = Object.fromEntries(Object.entries(just).map(([k, v]) => [k, String(v).slice(0, 400)]));
    save(); res.json({ validations: validations(req.audit) });
});
// starting-point mapping: Claude when an API key is set, otherwise keyword rules. `source` tells the UI which one it was.
app.post("/api/audits/:id/mapping/suggest", find, async (req, res) => {
    const outs = outcomesFor(req.audit), cols = COL(req.audit);
    let matrix, source = "rules";
    if (audit.hasAI()) { try { matrix = await audit.aiSuggestMapping(outs, cols); source = "ai"; } catch (e) { console.warn("AI mapping skipped:", e.message); } }
    if (!matrix) matrix = audit.suggestMapping(outs, cols);
    res.json({ matrix, source });
});

app.get("/api/audits/:id/export", find, (req, res) => {
    const a = req.audit, fmt = req.query.format;
    if (fmt === "fragment") return res.type("html").send(docFragment(a));
    const page = `<!doctype html><meta charset="utf-8"><title>${esc(a.code)} Course Specification</title><style>${DOC_CSS}</style>${docFragment(a)}${req.query.print ? "<script>window.onload=()=>print()</script>" : ""}`;
    if (fmt === "doc") res.set({ "Content-Type": "application/msword", "Content-Disposition": `attachment; filename="${a.code}_Course_Specification.doc"` });
    res.send(page);
});
app.post("/api/audits/:id/approval", find, (req, res) => { req.audit.status = "Sent for approval"; save(); res.json({ ok: true }); });

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => res.status(err instanceof multer.MulterError || err.message?.startsWith("Only") ? 400 : 500).json({ error: err.message || "Server error" }));

app.listen(PORT, () => console.log(`CourseSpec AI running at http://localhost:${PORT}`));