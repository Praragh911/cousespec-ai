const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = $("#view");
let cur = "cs201"; // last opened audit, used by the sidebar "Outcome Mapping" link
let user = { name: "there", role: "" }; // filled in from /api/auth/me when the page loads

async function api(url, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const res = await fetch("/api" + url, {
        ...opts,
        headers: isForm ? {} : { "Content-Type": "application/json" },
        body: opts.body && !isForm ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = "/login.html"; throw new Error("Please sign in"); }
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
}
let tt;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2600); }
const icons = () => window.lucide && lucide.createIcons();
const go = (h) => (location.hash = "#/" + h);
const fmtDate = (iso) => {
    const d = new Date(iso), n = new Date(), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const days = Math.floor((n.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    return days === 0 ? `Today, ${t}` : days === 1 ? `Yesterday, ${t}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${t}`;
};
const tone = { "Ready to export": "green", "Needs review": "amber", "Audit complete": "indigo", "Issues found": "red", "Sent for approval": "gray" };
const scoreCls = (s) => (s >= 85 ? "green" : s >= 70 ? "amber" : "red");
const sev = { Critical: ["red", "alert-circle"], Warning: ["amber", "alert-triangle"], Suggestion: ["gray", "lightbulb"] };

function header(o) {
    return `<div class="ph"><div>${o.eyebrow ? `<div class="eyebrow">${o.eyebrow}</div>` : ""}<h1>${o.title}</h1>${o.sub ? `<p>${o.sub}</p>` : ""}</div><div class="acts">${o.acts || ""}</div></div>`;
}
function stepper(n) {
    return `<div class="steps">${["Upload", "Audit", "Review", "Export"].map((s, i) => {
        const k = i + 1, cls = k < n ? "done" : k === n ? "on" : "";
        return `<div class="st ${cls}"><i>${k < n ? '<i data-lucide="check"></i>' : k}</i><span>${s}</span></div>${k < 4 ? `<div class="ln ${k < n ? "done" : ""}"></div>` : ""}`;
    }).join("")}</div>`;
}
function rows(list) {
    if (!list.length) return `<div class="empty">No documents match your filters.</div>`;
    return `<div class="thead"><span>Document</span><span>Last updated</span><span>Audit score</span><span>Status</span><span></span></div>` + list.map((d) => `
  <div class="trow">
    <button class="dn" data-open="${d.id}"><span class="fi"><i data-lucide="file-text"></i></span><span><b>${esc(d.title)}</b><small>${esc(d.code)} · Course specification</small></span></button>
    <span class="hide">${fmtDate(d.updated)}</span>
    <span class="hide"><span class="score ${scoreCls(d.score)}">${d.score}</span><span class="pb"><i style="width:${d.score}%"></i></span></span>
    <span><span class="badge ${tone[d.status] || "gray"}">${d.status}</span></span>
    <button class="btn g sm" data-menu="${d.id}" aria-label="Row actions"><i data-lucide="more-horizontal"></i></button>
  </div>`).join("");
}
function bindRows(root) {
    $$("[data-open]", root).forEach((b) => (b.onclick = () => go("audit/" + b.dataset.open)));
    $$("[data-menu]", root).forEach((b) => (b.onclick = (e) => {
        e.stopPropagation(); $$(".menu").forEach((m) => m.remove());
        const id = b.dataset.menu, m = document.createElement("div"); m.className = "menu";
        m.innerHTML = `<button data-a="open">Open audit</button><button data-a="mapping">Outcome mapping</button><button data-a="export">Download report</button>`;
        b.closest(".trow").append(m);
        m.onclick = (ev) => { const a = ev.target.dataset.a; if (a === "open") go("audit/" + id); if (a === "mapping") go("mapping/" + id); if (a === "export") window.open(`/api/audits/${id}/export?format=doc`); m.remove(); };
    }));
}
document.addEventListener("click", () => $$(".menu").forEach((m) => m.remove()));

/* ---------------- Pages ---------------- */
const pages = {
    async overview() {
        const [s, list] = await Promise.all([api("/stats"), api("/audits")]);
        const mini = `<div class="mini">${[10, 14, 20, 26, 32].map((h) => `<i style="height:${h}px"></i>`).join("")}</div>`;
        const stat = (ic, c, l, v, n, nc) => `<div class="card stat"><span class="ic ${c}"><i data-lucide="${ic}"></i></span><div class="mut">${l}</div><div class="row"><div><b>${v}</b> <small style="display:inline;color:${nc}">${n}</small></div>${mini}</div></div>`;
        view.innerHTML = header({ title: `Good morning, ${esc(user.name.replace(/^Dr\.\s*/, "").split(" ")[0])}`, sub: "Here’s what’s happening across your academic quality workspace.", acts: `<button class="btn p" data-go="new"><i data-lucide="plus"></i>New course audit</button>` }) + `
    <div class="grid g2" style="margin-bottom:24px">
      ${stat("file-search", "indigo", "Documents audited", s.audited, "+18 this month", "var(--ok)")}
      ${stat("shield-check", "green", "Average compliance", s.compliance + "%", "+4.2% from last month", "var(--ok)")}
      ${stat("alert-triangle", "amber", "Open findings", s.openFindings, s.needAttention + " require attention", "var(--warn)")}
      ${stat("clock", "indigo", "Review time saved", s.hoursSaved + "h", "Across 12 reviewers", "var(--ok)")}
    </div>
    <div class="card"><div class="pad" style="display:flex;justify-content:space-between"><div><b style="font-size:16px">Recent documents</b><small>Course specifications recently added to your workspace.</small></div><button class="btn g" data-go="documents">View all <i data-lucide="arrow-right"></i></button></div><div id="rows">${rows(list)}</div></div>`;
        bindRows(view);
    },

    async documents() {
        const list = await api("/audits");
        view.innerHTML = header({ title: "My Documents", sub: "All course specifications in your workspace.", acts: `<button class="btn p" data-go="new"><i data-lucide="plus"></i>New course audit</button>` }) + `
    <div class="card"><div class="tools"><input id="q" placeholder="Search by title or code" /><select id="f" style="max-width:220px"><option>All</option><option>Ready to export</option><option>Needs review</option><option>Audit complete</option><option>Issues found</option></select></div><div id="rows"></div></div>`;
        const draw = () => {
            const q = $("#q").value.toLowerCase(), f = $("#f").value;
            $("#rows").innerHTML = rows(list.filter((d) => (f === "All" || d.status === f) && (d.title + d.code).toLowerCase().includes(q)));
            bindRows(view); icons();
        };
        $("#q").oninput = draw; $("#f").onchange = draw; draw();
    },

    async history() {
        const list = await api("/audits");
        view.innerHTML = header({ title: "Audit History", sub: "Every audit run by your team, newest first." }) + `<div class="card">${list.map((d) => `
      <div class="pad" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line)">
        <div style="flex:1;min-width:200px"><b>${esc(d.code)} · ${esc(d.title)}</b><small>${fmtDate(d.updated)} · by Dr. Aisha Mehta</small></div>
        <span class="mut">${d.counts.critical} critical · ${d.counts.warning} warnings</span><span class="score ${scoreCls(d.score)}">${d.score}</span>
        <button class="btn sm" data-go="audit/${d.id}">View</button></div>`).join("")}</div>`;
    },

    async templates() {
        const t = await api("/templates");
        view.innerHTML = header({ title: "Templates", sub: "Approved layouts used to check required sections.", acts: `<button class="btn p" data-go="new"><i data-lucide="plus"></i>Upload template</button>` }) +
            `<div class="grid g2">${t.map((x, i) => `<div class="card pad"><span class="ic indigo"><i data-lucide="library"></i></span><b>${esc(x.name)}</b><small>${esc(x.meta)}</small>
      <div style="display:flex;justify-content:space-between;margin-top:16px"><span class="mut">Used in ${x.used} audits</span><a class="lnk" data-t="${i}">Set as default</a></div></div>`).join("")}</div>`;
        $$("[data-t]").forEach((a) => (a.onclick = () => toast("Default template updated")));
    },

    async new() {
        let file = null, tpl = null, busy = false;
        view.innerHTML = header({ title: "Start a new course audit", sub: "Upload a course specification and we’ll check structure, language, alignment, and academic compliance." }) + stepper(1) + `
    <div class="layout"><div class="stack">
      <div class="card pad"><b>Course specification</b><small style="margin-bottom:14px">Upload a PDF or DOCX. Scanned PDFs are supported.</small><div id="fileBox"></div></div>
      <div class="card pad"><b>Course details</b><small style="margin-bottom:14px">Confirm the information extracted from your document.</small>
        <div class="grid" style="grid-template-columns:2fr 1fr"><label><span>Course title</span><input id="title" value="Data Structures and Algorithms"></label><label><span>Course code</span><input id="code" value="CS201"></label></div>
        <div class="grid g2" style="margin-top:16px">
          <label><span>Program</span><select id="program"><option>B.Tech. Computer Science</option><option>B.Tech. Electronics</option><option>B.Tech. Mechanical</option></select></label>
          <label><span>Academic year</span><select id="year"><option>2025–26</option><option>2024–25</option><option>2023–24</option></select></label>
          <label><span>Credits</span><input id="credits" type="number" min="1" max="10" value="4"></label>
          <label><span>Semester</span><select id="semester">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === 3 ? "selected" : ""}>Semester ${n}</option>`).join("")}</select></label></div></div>
      <div class="card pad"><b>University template <span class="badge gray" style="font-size:11px;padding:1px 8px">Optional</span></b><small style="margin-bottom:14px">Upload your approved template to check layout and required sections.</small>
        <label class="drop" style="flex-direction:row;padding:14px;text-align:left"><i data-lucide="upload"></i><span style="flex:1"><b id="tplName">Upload template</b><small>PDF or DOCX · up to 10 MB</small></span><i data-lucide="plus"></i><input id="tplIn" type="file" accept=".pdf,.docx"></label></div>
    </div>
    <div class="card side-card"><span class="ic indigo"><i data-lucide="wand-2"></i></span><b style="font-size:18px">Ready to audit</b><small>CourseSpec AI will run 42 academic and document-quality checks.</small>
      <ul>${["Course structure & completeness", "Bloom’s taxonomy alignment", "CO–PO–PSO mapping", "Hours & assessment validation", "Language & consistency"].map((c) => `<li><i data-lucide="check-circle-2"></i>${c}</li>`).join("")}</ul>
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:14px"><span class="mut">Estimated time</span><b>~45 seconds</b></div>
      <button id="start" class="btn p" style="width:100%;margin-top:18px;padding:13px"><i data-lucide="wand-2"></i>Start AI audit</button><div class="err" id="err"></div>
      <small style="text-align:center;margin-top:12px">Your documents are encrypted and private.</small></div></div>`;
        const drawFile = () => {
            $("#fileBox").innerHTML = file
                ? `<div class="file"><span class="fi">${file.name.toLowerCase().endsWith("pdf") ? "PDF" : "DOC"}</span><div class="nm"><b>${esc(file.name)}</b><small>${(file.size / 1048576).toFixed(1)} MB · Ready to audit</small></div><span class="badge green">Uploaded</span><button class="btn g sm" id="rm" aria-label="Remove file"><i data-lucide="x"></i></button></div>`
                : `<label class="drop"><i data-lucide="upload" style="color:var(--brand)"></i><b>Click to choose a PDF or DOCX</b><input id="fileIn" type="file" accept=".pdf,.docx"></label>`;
            icons();
            if (file) $("#rm").onclick = () => { file = null; drawFile(); };
            else $("#fileIn").onchange = (e) => { file = e.target.files[0]; drawFile(); };
        };
        drawFile();
        $("#tplIn").onchange = (e) => { tpl = e.target.files[0]; $("#tplName").textContent = tpl ? tpl.name : "Upload template"; };
        $("#start").onclick = async () => {
            if (busy) return; $("#err").textContent = "";
            const fd = new FormData();
            if (!file) return ($("#err").textContent = "Upload a specification to continue.");
            fd.append("file", file);
            ["title", "code", "program", "year", "credits", "semester"].forEach((k) => fd.append(k, $("#" + k).value));
            busy = true; $("#start").disabled = true; $("#start").innerHTML = `<i data-lucide="loader-2" class="spin"></i>Auditing…`; icons();
            try { const a = await api("/audits", { method: "POST", body: fd }); go("audit/" + a.id); }
            catch (e) { $("#err").textContent = e.message; busy = false; $("#start").disabled = false; $("#start").innerHTML = `<i data-lucide="wand-2"></i>Start AI audit`; icons(); }
        };
    },

    async audit(id) {
        const a = await api("/audits/" + id); cur = id;
        let filter = "All", sel = a.findings[0].id, zoom = 90;
        const c = a.counts;
        view.innerHTML = header({
            eyebrow: `${esc(a.code)} · AUDIT COMPLETE`, title: esc(a.title), sub: `Audited ${fmtDate(a.updated).toLowerCase()} · 9 pages · Northbridge University`,
            acts: `<button class="btn" id="rep"><i data-lucide="download"></i>Audit report</button><button class="btn p" data-go="review/${id}"><i data-lucide="wand-2"></i>Review corrections</button>`
        }) + stepper(2) + `
    <div class="card pad" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <div class="ring"><svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="46" fill="none" stroke="#e6f6ef" stroke-width="9"/><circle cx="55" cy="55" r="46" fill="none" stroke="#0e9f6e" stroke-width="9" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="${289 * (1 - a.score / 100)}"/></svg><div><span>${a.score}<small>/100</small></span></div></div>
      <div style="flex:1;min-width:240px"><span class="badge green">Strong specification</span><div style="font-size:18px;font-weight:600;margin:10px 0 4px">Review-ready with minor changes</div><div class="mut">Most sections meet institutional standards. Resolve ${c.critical} critical issue${c.critical === 1 ? "" : "s"} and ${c.warning} warning${c.warning === 1 ? "" : "s"} before export.</div></div></div>
    <div class="grid g3" style="margin-bottom:16px">${[["alert-circle", "red", c.critical, "Critical issue"], ["alert-triangle", "amber", c.warning, "Warnings"], ["check-circle-2", "green", c.passed, "Checks passed"]].map(([i, t, n, l]) => `<div class="card pad" style="display:flex;gap:16px;align-items:center"><span class="ic ${t}" style="margin:0"><i data-lucide="${i}"></i></span><div><b style="font-size:24px">${n}</b><div class="mut">${l}</div></div></div>`).join("")}</div>
    <div class="grid" style="grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)" id="split">
      <div class="card" style="overflow:hidden"><div class="pad" style="display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:16px">Audit findings</b><small>${a.findings.length} recommendations across 3 categories</small></div>
        <select id="flt" style="width:auto"><option>All</option><option>Critical</option><option>Warning</option><option>Suggestion</option></select></div><div id="fl"></div></div>
      <div class="card" style="overflow:hidden"><div class="pad" style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--mut)"><b style="color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.file)}</b><span class="zoom"><button id="zo" aria-label="Zoom out">−</button><span id="zv">${zoom}%</span><button id="zi" aria-label="Zoom in">+</button></span></div><div class="viewer" id="dv">${a.doc}</div></div></div>`;
        const drawList = () => {
            $("#fl").innerHTML = a.findings.filter((f) => filter === "All" || f.severity === filter).map((f) => `
      <button class="finding ${f.id === sel ? "on" : ""}" data-f="${f.id}"><span class="fic ${sev[f.severity][0]}"><i data-lucide="${sev[f.severity][1]}"></i></span>
      <span style="flex:1"><span class="badge ${sev[f.severity][0]}">${f.severity}</span>${f.decision ? ` <small style="display:inline;color:var(--ok)">${f.decision === "accepted" ? "Resolved" : "Rejected"}</small>` : ""}<b>${esc(f.title)}</b><small>${esc(f.detail)}</small><small style="font-size:11px">${esc(f.where)}</small></span><i data-lucide="chevron-right" style="width:16px"></i></button>`).join("");
            $$("[data-f]").forEach((b) => (b.onclick = () => { sel = +b.dataset.f; drawList(); })); icons();
        };
        drawList();
        $("#flt").onchange = (e) => { filter = e.target.value; drawList(); };
        const setZoom = (z) => { zoom = Math.max(50, Math.min(130, z)); $(".doc", view).style.zoom = zoom / 100; $("#zv").textContent = zoom + "%"; };
        $("#zo").onclick = () => setZoom(zoom - 10); $("#zi").onclick = () => setZoom(zoom + 10);
        $("#rep").onclick = () => {
            const t = `CourseSpec AI audit report\n${a.code} · ${a.title}\nScore: ${a.score}/100\n\n` + a.findings.map((f) => `[${f.severity}] ${f.title}\n  ${f.detail}\n  ${f.where}`).join("\n\n");
            const l = document.createElement("a"); l.href = URL.createObjectURL(new Blob([t], { type: "text/plain" })); l.download = `${a.code}_audit_report.txt`; l.click(); toast("Audit report downloaded");
        };
    },

    async review(id) {
        let a = await api("/audits/" + id); cur = id; const editing = new Set();
        const draw = () => {
            const done = a.findings.filter((f) => f.decision).length;
            const blocked = a.findings.some((f) => f.severity === "Critical" && !f.decision);
            view.innerHTML = header({
                eyebrow: `${esc(a.code)} · CORRECTION REVIEW`, title: "Review suggested corrections", sub: `${done} of ${a.findings.length} reviewed. Accept, edit, or reject each suggestion.`,
                acts: `<button class="btn" id="all">Accept all</button><button class="btn p" id="next" ${blocked ? "disabled" : ""}>Continue to mapping <i data-lucide="arrow-right"></i></button>`
            }) + stepper(3) +
                (blocked ? `<div class="note">Resolve the critical issue to continue.</div>` : "") +
                a.findings.map((f) => `<div class="card pad" style="margin-bottom:16px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="badge ${sev[f.severity][0]}">${f.severity}</span><b>${esc(f.title)}</b>${f.decision ? `<small style="margin-left:auto;color:${f.decision === "accepted" ? "var(--ok)" : "var(--mut)"}">${f.decision === "accepted" ? "Accepted" : "Rejected"}</small>` : ""}</div><small style="margin:6px 0">${esc(f.where)}</small>
        <div class="cmp"><div style="background:rgba(253,236,235,.6)"><b style="color:var(--bad)">Original</b><span class="del">${esc(f.original)}</span></div><div style="background:rgba(230,246,239,.7)"><b style="color:var(--ok)">Suggested</b>${editing.has(f.id) ? `<textarea rows="3" id="t${f.id}">${esc(f.suggestion)}</textarea>` : esc(f.suggestion)}</div></div>
        <div class="acts"><button class="btn p sm" data-d="accepted" data-i="${f.id}"><i data-lucide="check"></i>Accept</button><button class="btn sm" data-e="${f.id}"><i data-lucide="pencil"></i>${editing.has(f.id) ? "Done editing" : "Edit"}</button><button class="btn sm" data-d="rejected" data-i="${f.id}"><i data-lucide="x"></i>Reject</button></div></div>`).join("");
            icons();
            $("#next").onclick = () => go("mapping/" + id);
            $("#all").onclick = async () => { await api(`/audits/${id}/findings/accept-all`, { method: "POST" }); a = await api("/audits/" + id); toast("All suggestions accepted"); draw(); };
            $$("[data-d]").forEach((b) => (b.onclick = async () => {
                const fid = +b.dataset.i, ta = $("#t" + fid);
                try { await api(`/audits/${id}/findings/${fid}`, { method: "PATCH", body: { decision: b.dataset.d, ...(ta ? { text: ta.value } : {}) } }); editing.delete(fid); a = await api("/audits/" + id); draw(); }
                catch (e) { toast(e.message); }
            }));
            $$("[data-e]").forEach((b) => (b.onclick = async () => {
                const fid = +b.dataset.e, ta = $("#t" + fid);
                if (editing.has(fid)) { if (ta) await api(`/audits/${id}/findings/${fid}`, { method: "PATCH", body: { text: ta.value } }); editing.delete(fid); a = await api("/audits/" + id); } else editing.add(fid);
                draw();
            }));
        };
        draw();
    },

    async mapping(id) {
        cur = id; const a = await api("/audits/" + id), m = await api(`/audits/${id}/mapping`);
        let { matrix, just } = m, validations = m.validations, sel = { r: 1, c: 1 }; const initial = JSON.parse(JSON.stringify(matrix));
        view.innerHTML = header({
            title: "CO–PO–PSO Mapping", sub: "Map course outcomes to program outcomes and document the strength of each relationship.",
            acts: `<button class="btn" id="imp"><i data-lucide="upload"></i>Import matrix</button><button class="btn p" data-go="preview/${id}">Continue to preview <i data-lucide="arrow-right"></i></button>`
        }) + `<div id="mb"></div>`;
        const key = () => `${m.outcomes[sel.r].id}-${m.cols[sel.c]}`;
        const persist = async () => { try { validations = (await api(`/audits/${id}/mapping`, { method: "PUT", body: { matrix, just } })).validations; } catch (e) { toast(e.message); } };
        const draw = () => {
            const strong = matrix.flat().filter((v) => v === 3).length;
            $("#mb").innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(3,1fr) auto;margin-bottom:20px;align-items:center" id="sum">
        ${[["check-circle-2", "var(--ok)", `${m.outcomes.length} outcomes mapped`, "All course outcomes included"], ["zap", "var(--ok)", `${strong} strong mappings`, "Strength level 3"], ["alert-triangle", "var(--warn)", `${validations.length} validations`, "Review before export"]].map(([i, c, t, s]) => `<div class="card pad" style="display:flex;gap:12px;align-items:center;padding:14px"><i data-lucide="${i}" style="color:${c}"></i><div><b>${t}</b><small>${s}</small></div></div>`).join("")}
        <div class="legend">Strength ${["None", "Low", "Medium", "High"].map((l, i) => `<span><i class="c${i}">${i}</i>${l}</span>`).join("")}</div></div>
      <div class="card" style="overflow:hidden;margin-bottom:20px"><div class="pad" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px"><div><b style="font-size:16px">Alignment matrix</b><small>Click any cell to cycle its mapping strength from 0–3.</small></div>
        <div class="acts"><button class="btn g" id="rst"><i data-lucide="rotate-ccw"></i>Reset</button><button class="btn g" id="ai" style="color:var(--brand)"><i data-lucide="wand-2"></i>Suggest with AI</button></div></div>
        <div class="tw"><table class="mx"><tr><th>Course outcome</th>${m.cols.map((c) => `<th>${c}<br><small>${c.startsWith("PSO") ? "Program specific" : "Program outcome"}</small></th>`).join("")}</tr>
        ${m.outcomes.map((o, r) => `<tr class="${sel.r === r ? "sel" : ""}"><td><div class="co"><b>${o.id}</b><span>${esc(o.text)}</span></div></td>${matrix[r].map((v, c) => `<td><button class="cell c${v} ${sel.r === r && sel.c === c ? "cur" : ""}" data-r="${r}" data-c="${c}" aria-label="${o.id} to ${m.cols[c]}: ${v}">${v}</button></td>`).join("")}</tr>`).join("")}</table></div>
        <div class="pad mut" style="border-top:1px solid var(--line);font-size:12px;padding:12px 20px">Mapping strengths should reflect direct, assessable relationships—not general topic overlap.</div></div>
      <div class="grid g3"><div class="card pad"><div style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><span class="logo" style="width:40px;height:40px;font-size:12px;font-weight:700">${m.outcomes[sel.r].id}</span><b>Outcome description</b></div><p style="border-left:2px solid var(--brand);background:rgba(238,237,253,.4);padding:12px;margin:0">${esc(m.outcomes[sel.r].text)}</p></div>
        <div class="card pad"><div style="display:flex;justify-content:space-between;margin-bottom:12px"><b>Mapping justification</b><span class="badge gray">${key().replace("-", " – ")}</span></div><textarea id="jt" rows="4" maxlength="400" placeholder="Explain how this course outcome contributes to the selected program outcome.">${esc(just[key()] || "")}</textarea></div>
        <div class="card pad vw"><b><i data-lucide="alert-triangle" style="width:16px;color:var(--warn)"></i> Validation warnings</b><small style="margin-bottom:8px">${validations.length} items need review</small>${validations.length ? validations.map((v) => `<div>${esc(v)}</div>`).join("") : `<div style="color:var(--ok)">All mappings validated.</div>`}</div></div>`;
            icons();
            $$(".cell").forEach((b) => (b.onclick = async () => { const r = +b.dataset.r, c = +b.dataset.c; matrix[r][c] = (matrix[r][c] + 1) % 4; sel = { r, c }; await persist(); draw(); }));
            $("#rst").onclick = async () => { matrix = JSON.parse(JSON.stringify(initial)); await persist(); draw(); toast("Matrix reset"); };
            $("#ai").onclick = async () => { matrix = (await api(`/audits/${id}/mapping/suggest`, { method: "POST" })).matrix; await persist(); draw(); toast("AI suggestions applied (mock)"); };
            $("#jt").onchange = async (e) => { just[key()] = e.target.value; await persist(); draw(); };
        };
        $("#imp").onclick = () => toast("Import is not connected yet — edit the matrix directly");
        draw();
    },

    async preview(id) {
        cur = id; const a = await api("/audits/" + id); let zoom = 85, sent = a.status === "Sent for approval";
        view.innerHTML = header({ title: "Preview &amp; export", sub: "Your corrected course specification is ready for academic review and approval.", acts: `<button class="btn" data-go="mapping/${id}"><i data-lucide="arrow-left"></i>Back to mapping</button>` }) + stepper(4) + `
    <div class="layout"><div class="card" style="overflow:hidden;min-width:0"><div class="pad noprint" style="display:flex;justify-content:space-between;font-size:12px;color:var(--mut);padding:12px 20px"><span class="zoom"><button id="zo">−</button><span id="zv">${zoom}%</span><button id="zi">+</button></span><span>Page 1 of 8</span></div><div class="viewer" style="max-height:720px">${a.doc}</div></div>
    <div class="noprint" style="display:grid;gap:16px;height:fit-content">
      <div class="ready"><i data-lucide="check-circle-2" style="width:34px;height:34px;color:var(--ok)"></i><div><b>Document ready</b><small>All critical issues have been resolved.</small></div></div>
      <div class="card pad"><b>Export document</b><small style="margin-bottom:14px">Choose your preferred file format.</small>
        <button class="exp" id="pdf"><span class="fi red" style="font-size:11px;font-weight:700">PDF</span><span><b>Download PDF</b><small>Best for sharing and review</small></span><i data-lucide="download"></i></button>
        <button class="exp" id="docx"><span class="fi" style="font-weight:700">W</span><span><b>Download DOCX</b><small>Editable Microsoft Word file</small></span><i data-lucide="download"></i></button>
        <button class="btn" id="send" style="width:100%;padding:12px" ${sent ? "disabled" : ""}><i data-lucide="send"></i>${sent ? "Sent for approval" : "Send for approval"}</button></div>
      <div class="card pad"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><b>Document checks</b><span class="badge green">Passed</span></div>${["42 academic checks passed", "All corrections reviewed", "CO-PO-PSO mapping validated", "Template formatting applied"].map((c) => `<div class="chk"><i data-lucide="check-circle-2"></i>${c}</div>`).join("")}</div>
      <div class="card pad" style="display:flex;gap:12px;align-items:center"><i data-lucide="file-clock"></i><div style="flex:1"><b>Version 3 · Final</b><small>Saved just now by Dr. Aisha Mehta</small></div><a class="lnk" data-go="history">History</a></div></div></div>`;
        const setZoom = (z) => { zoom = Math.max(50, Math.min(130, z)); $(".doc", view).style.zoom = zoom / 100; $("#zv").textContent = zoom + "%"; };
        setZoom(85); $("#zo").onclick = () => setZoom(zoom - 10); $("#zi").onclick = () => setZoom(zoom + 10);
        $("#pdf").onclick = () => { toast("Choose “Save as PDF” in the print dialog"); window.open(`/api/audits/${id}/export?format=html&print=1`, "_blank"); };
        $("#docx").onclick = () => { window.location = `/api/audits/${id}/export?format=doc`; toast("Word file downloaded"); };
        $("#send").onclick = async () => { await api(`/audits/${id}/approval`, { method: "POST" }); $("#send").disabled = true; $("#send").lastChild.textContent = "Sent for approval"; toast("Sent to the Academic Council for approval"); };
    },
};

/* ---------------- Router ---------------- */
const crumbs = { overview: ["Workspace", "Overview"], documents: ["Workspace", "My Documents"], new: ["Audits", "New course audit"], templates: ["Workspace", "Templates"], history: ["Workspace", "Audit History"], audit: ["CS201", "Audit results"], review: ["CS201", "Correction review"], mapping: ["CS201", "Outcome mapping"], preview: ["CS201", "Final preview"] };
const activeNav = { audit: "history", review: "history", preview: "documents" };
async function render() {
    const [r, id] = (location.hash.slice(2) || "overview").split("/");
    const name = pages[r] ? r : "overview";
    document.body.classList.remove("nav");
    const [a, b] = crumbs[name]; $("#crumb").innerHTML = `${id ? id.toUpperCase() : a} › <b>${b}</b>`;
    $$("#side nav a[data-r]").forEach((l) => l.classList.toggle("on", l.dataset.r === (activeNav[name] || name)));
    view.innerHTML = `<div class="empty">Loading…</div>`;
    try { await pages[name](id || cur); }
    catch (e) { view.innerHTML = `<div class="card empty"><b>Something went wrong</b><p>${esc(e.message)}</p><button class="btn p" data-go="overview">Back to overview</button></div>`; }
    icons(); window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => { const t = e.target.closest("[data-go]"); if (t) go(t.dataset.go); });
$$("#side nav a[data-r]").forEach((l) => (l.onclick = () => go(l.dataset.r === "mapping" ? "mapping/" + cur : l.dataset.r)));
$("#menu").onclick = () => document.body.classList.add("nav");
$("#scrim").onclick = () => document.body.classList.remove("nav");
$("#bell").onclick = () => toast("No new notifications");
window.addEventListener("hashchange", render);

// Start the app only after we know who is signed in (api() redirects to /login.html on 401)
(async () => {
    try { user = (await api("/auth/me")).user; } catch { return; }
    const initials = user.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    $(".me").innerHTML = `<span class="av">${esc(initials)}</span><span style="flex:1;min-width:0"><b>${esc(user.name)}</b><small>${esc(user.role)}</small></span><button class="btn g sm" id="logout" title="Sign out" aria-label="Sign out"><i data-lucide="log-out"></i></button>`;
    $("#logout").onclick = async () => { await api("/auth/logout", { method: "POST" }); location.href = "/login.html"; };
    render();
})();