"use strict";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const $ = (sel) => document.querySelector(sel);
const nf = new Intl.NumberFormat("he-IL");

/** Build DOM safely: every string child becomes a text node (chat text is untrusted). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function show(viewId) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== viewId;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
}

function toast(msg) {
  const t = el("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

/* ------------------------------------------------------------------ *
 * Upload form
 * ------------------------------------------------------------------ */
let activeTab = "file";
let chosenFile = null;

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t === tab));
    $("#pane-file").hidden = activeTab !== "file";
    $("#pane-paste").hidden = activeTab !== "paste";
  });
}

const fileInput = $("#file-input");
const dropzone = $("#dropzone");

function setFile(file) {
  chosenFile = file || null;
  const label = $("#file-name");
  label.hidden = !chosenFile;
  label.textContent = chosenFile ? `📄 ${chosenFile.name}` : "";
  hideFormError();
}

fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
for (const ev of ["dragenter", "dragover"]) {
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
}
for (const ev of ["dragleave", "drop"]) {
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); });
}
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) setFile(f);
});

function showFormError(msg) {
  const box = $("#form-error");
  box.textContent = msg;
  box.hidden = false;
}
function hideFormError() { $("#form-error").hidden = true; }

$("#roast-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideFormError();

  const form = new FormData();
  form.append("spice", document.querySelector('input[name="spice"]:checked').value);
  form.append("language", $("#language").value);

  if (activeTab === "file") {
    if (!chosenFile) return showFormError("בחרו קובץ צ'אט קודם.");
    form.append("file", chosenFile, chosenFile.name);
  } else {
    const text = $("#paste-input").value.trim();
    if (!text) return showFormError("הדביקו קודם את טקסט הצ'אט.");
    form.append("text", text);
  }

  await runRoast(form);
});

/* ------------------------------------------------------------------ *
 * Loading screen
 * ------------------------------------------------------------------ */
const FUNNY_LINES = [
  "סופרים כמה פעמים כתבתם 'חחחח'…",
  "מחפשים מי שולח הודעות קוליות של 4 דקות…",
  "בודקים מי אף פעם לא עונה לסקרים…",
  "מגלים מי כותב ב-3 לפנות בוקר…",
  "מחדדים את הסכינים…",
  "מתעדים כל 'בדרך!' שנשלח מהבית…",
  "מחפשים את ההודעה הכי ארוכה שאף אחד לא קרא…",
];
let lineTimer = null;

function startLoading() {
  let i = Math.floor(Math.random() * FUNNY_LINES.length);
  $("#loading-line").textContent = FUNNY_LINES[i];
  clearInterval(lineTimer);
  lineTimer = setInterval(() => {
    i = (i + 1) % FUNNY_LINES.length;
    $("#loading-line").textContent = FUNNY_LINES[i];
  }, 3500);
  setLoading("מעלים את הצ'אט…", 4);
  $("#early-stats").replaceChildren();
  show("loading-view");
}

function setLoading(title, pct) {
  $("#loading-title").textContent = title;
  $("#progress-bar").style.width = `${Math.max(4, Math.min(98, pct))}%`;
}

function stopLoading() { clearInterval(lineTimer); }

/* ------------------------------------------------------------------ *
 * Talking to the server (newline-delimited JSON stream)
 * ------------------------------------------------------------------ */
async function runRoast(form) {
  const btn = $("#submit-btn");
  btn.disabled = true;
  startLoading();

  let statsEvent = null;
  try {
    const res = await fetch("/api/roast", { method: "POST", body: form });
    if (!res.ok) {
      let msg = "משהו השתבש. נסו שוב.";
      try { msg = (await res.json()).error || msg; } catch (_) { /* not JSON */ }
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let expectedChars = 4000;
    let done = false;

    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);

        if (ev.type === "stats") {
          statsEvent = ev;
          expectedChars = 1800 + ev.roasted_members.length * 520;
          setLoading(`נמצאו ${nf.format(ev.stats.total_messages)} הודעות מ-${nf.format(ev.stats.member_count)} חברים. Claude קורא הכל…`, 15);
          $("#early-stats").replaceChildren(renderKpis(ev.stats), renderActivity(ev.stats));
        } else if (ev.type === "progress") {
          if (ev.phase === "thinking") setLoading("Claude מחפש על מה לרדת על כל אחד…", 30);
          else setLoading("כותב את הירידות…", 40 + (55 * (ev.chars || 0)) / expectedChars);
        } else if (ev.type === "result") {
          stopLoading();
          renderResults(statsEvent, ev.roast);
          done = true;
        } else if (ev.type === "error") {
          throw new Error(ev.error);
        }
      }
    }
    if (!done) throw new Error("החיבור נקטע לפני שהתוצאה הגיעה. נסו שוב.");
  } catch (err) {
    stopLoading();
    if (statsEvent) {
      renderResults(statsEvent, null, err.message);
    } else {
      show("upload-view");
      showFormError(err.message || "משהו השתבש. נסו שוב.");
    }
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */
function renderResults(statsEvent, roast, errorMsg) {
  const { stats, included_messages: included, roasted_members: roasted } = statsEvent;
  const view = $("#results-view");
  $("#early-stats").replaceChildren(); // the preview shown while loading
  const byName = Object.fromEntries(stats.members.map((m, i) => [m.name, { ...m, rank: i + 1 }]));

  const parts = [];

  // Hero
  parts.push(el("div", { class: "result-hero" },
    el("div", { class: "kicker", dir: "auto" }, stats.group_name || "הקבוצה שלכם"),
    el("h1", { dir: "auto" }, roast ? roast.group_nickname : "הסטטיסטיקות של הקבוצה"),
    roast && el("p", { class: "one-liner", dir: "auto" }, roast.one_liner),
  ));

  if (errorMsg) {
    parts.push(el("p", { class: "error", role: "alert" }, `לא הצלחנו לכתוב את הירידות: ${errorMsg}`));
  }

  parts.push(renderKpis(stats));

  const notes = [];
  if (included < stats.total_messages) {
    notes.push(`Claude קרא את ${nf.format(included)} ההודעות האחרונות מתוך ${nf.format(stats.total_messages)}. הסטטיסטיקות מחושבות על כל הצ'אט.`);
  }
  if (roast && stats.member_count > roasted.length) {
    notes.push(`ירידות אישיות נכתבו ל-${roasted.length} החברים הפעילים ביותר. השאר ניצלו… הפעם.`);
  }
  if (notes.length) parts.push(el("div", { class: "notice" }, notes.join(" ")));

  if (roast) {
    // Summary
    parts.push(el("section", { class: "card summary" },
      el("h2", { class: "section-title" }, "📝 מה קורה פה בכלל"),
      roast.summary.split(/\n\s*\n/).filter(Boolean).map((p) => el("p", { dir: "auto" }, p.trim())),
      roast.topics.length ? el("div", { class: "chips" }, roast.topics.map((t) => el("span", { class: "chip", dir: "auto" }, t))) : null,
    ));

    // Memorable moments
    if (roast.memorable_moments.length) {
      parts.push(el("section", { class: "card" },
        el("h2", { class: "section-title" }, "🎬 רגעים בלתי נשכחים"),
        el("div", { class: "moments" }, roast.memorable_moments.map((m) =>
          el("div", { class: "moment" }, el("h3", { dir: "auto" }, m.title), el("p", { dir: "auto" }, m.description)))),
      ));
    }

    // Roasts
    parts.push(el("h2", { class: "section-title", style: "margin-top:28px" }, "🔥 הירידות"));
    parts.push(el("div", { class: "members" }, roast.members.map((m) => renderMember(m, byName[m.name], stats.total_messages))));

    // Awards
    parts.push(el("section", { class: "card", style: "margin-top:20px" },
      el("h2", { class: "section-title" }, "🏆 טקס הפרסים"),
      el("div", { class: "awards" }, roast.awards.map((a) =>
        el("div", { class: "award" },
          el("div", { class: "award-title", dir: "auto" }, a.title),
          el("div", { class: "award-winner" }, el("bdi", {}, a.winner)),
          el("p", { dir: "auto" }, a.reason)))),
      renderStatAwards(stats),
    ));
  } else {
    parts.push(el("section", { class: "card" },
      el("h2", { class: "section-title" }, "🏆 לפי המספרים"), renderStatAwards(stats, true)));
  }

  parts.push(renderActivity(stats));

  if (roast && roast.closing_line) parts.push(el("p", { class: "closing", dir: "auto" }, roast.closing_line));

  const actions = el("div", { class: "actions" });
  if (roast) {
    actions.append(
      el("button", { class: "btn", type: "button", onclick: () => shareRoast(roast) }, "📤 שתפו בקבוצה"),
      el("button", { class: "btn", type: "button", onclick: () => copyRoast(roast) }, "📋 העתיקו הכל"),
    );
  }
  actions.append(el("button", { class: "btn", type: "button", onclick: () => show("upload-view") }, "🔄 צלו קבוצה אחרת"));
  parts.push(actions);

  view.replaceChildren(...parts);
  show("results-view");
}

function renderKpis(stats) {
  const days = daysBetween(stats.first_date, stats.last_date);
  const kpi = (label, value, sub) =>
    el("div", { class: "kpi" }, el("div", { class: "kpi-label" }, label), el("div", { class: "kpi-value" }, value), sub ? el("div", { class: "kpi-sub" }, sub) : null);
  return el("div", { class: "kpis" },
    kpi("הודעות", nf.format(stats.total_messages), stats.media_total ? `${nf.format(stats.media_total)} מתוכן מדיה` : null),
    kpi("חברים פעילים", nf.format(stats.member_count)),
    kpi("ימים", days ? nf.format(days) : "—", stats.first_date ? `${formatDate(stats.first_date)} – ${formatDate(stats.last_date)}` : null),
    kpi("שעת השיא", stats.peak_hour !== null ? `${stats.peak_hour}:00` : "—",
      stats.busiest_day ? `יום שיא: ${formatDate(stats.busiest_day.date)} (${nf.format(stats.busiest_day.messages)})` : null),
  );
}

function renderMember(m, s, total) {
  const initial = (m.name.trim()[0] || "?").toUpperCase();
  const statsLine = s ? el("div", { class: "member-stats" },
    el("span", {}, el("strong", {}, nf.format(s.messages)), " הודעות"),
    el("span", {}, el("strong", {}, `${s.share}%`), " מהקבוצה"),
    s.avg_words ? el("span", {}, el("strong", {}, s.avg_words), " מילים להודעה") : null,
    s.media ? el("span", {}, el("strong", {}, nf.format(s.media)), " מדיה") : null,
    s.night_messages ? el("span", {}, el("strong", {}, nf.format(s.night_messages)), " הודעות לילה") : null,
    s.top_emojis.length ? el("span", {}, "אימוג'י אהוב: ", el("strong", {}, s.top_emojis[0])) : null,
  ) : null;

  return el("article", { class: "card member" },
    el("div", { class: "member-head" },
      el("div", { class: "avatar", "aria-hidden": "true" }, initial),
      el("div", {},
        el("div", { class: "member-name" }, el("bdi", {}, m.name)),
        el("div", { class: "member-nick", dir: "auto" }, m.nickname)),
      s ? el("div", { class: "member-rank" }, `#${s.rank} בפטפטנות`) : null,
    ),
    el("p", { class: "roast-text", dir: "auto" }, m.roast),
    m.quote ? el("blockquote", { class: "quote", dir: "auto" }, `"${m.quote}"`) : null,
    statsLine,
  );
}

function renderStatAwards(stats, standalone = false) {
  if (!stats.awards.length) return null;
  return el("div", {},
    standalone ? null : el("h3", { class: "subhead" }, "📊 לפי המספרים"),
    el("div", { class: "awards" }, stats.awards.map((a) =>
      el("div", { class: "award" },
        el("div", { class: "award-title" }, a.title),
        el("div", { class: "award-winner" }, el("bdi", {}, a.winner)),
        el("p", {}, el("span", { class: "award-value" }, nf.format(a.value)), ` ${a.unit}`)))),
  );
}

/** Ranked bars (one hue) + hour-of-day columns. */
function renderActivity(stats) {
  const TOP = 12;
  const members = stats.members.slice(0, TOP);
  const rest = stats.members.slice(TOP);
  const rows = members.map((m) => ({ name: m.name, messages: m.messages, share: m.share }));
  if (rest.length) {
    const msgs = rest.reduce((s, m) => s + m.messages, 0);
    rows.push({ name: `כל השאר (${rest.length})`, messages: msgs, share: Math.round((1000 * msgs) / stats.total_messages) / 10 });
  }
  const max = Math.max(...rows.map((r) => r.messages), 1);

  const bars = el("div", { class: "bars", role: "list", "aria-label": "חלק כל חבר מההודעות" },
    rows.map((r) => el("div", { class: "bar-row", role: "listitem", title: `${r.name}: ${nf.format(r.messages)} הודעות (${r.share}%)` },
      el("span", { class: "bar-name" }, el("bdi", {}, r.name)),
      el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: `width:${(100 * r.messages) / max}%` })),
      el("span", { class: "bar-value" }, `${r.share}%`),
    )));

  const hours = stats.hours || [];
  const hmax = Math.max(...hours, 1);
  const hasHours = hours.some((h) => h > 0);
  const hoursBlock = hasHours ? el("div", {},
    el("h3", { class: "subhead" }, "מתי הקבוצה ערה"),
    el("div", { class: "hours" },
      el("div", { class: "hours-plot", role: "img", "aria-label": `הודעות לפי שעה ביום. שעת השיא ${stats.peak_hour}:00` },
        hours.map((count, h) => {
          const label = `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00 · ${nf.format(count)} הודעות`;
          const col = el("div", { class: "hour-col", tabindex: "0", "aria-label": label },
            el("div", { class: "hour-bar", style: `height:${(100 * count) / hmax}%` }));
          attachTooltip(col, label);
          return col;
        })),
      el("div", { class: "hours-axis", "aria-hidden": "true" },
        hours.map((_, h) => el("span", {}, h % 3 === 0 ? String(h) : ""))),
    ),
    el("details", { class: "table-toggle" },
      el("summary", {}, "הצג כטבלה"),
      el("table", { class: "data-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "שעה"), el("th", {}, "הודעות"))),
        el("tbody", {}, hours.map((c, h) => el("tr", {}, el("td", {}, `${h}:00`), el("td", {}, nf.format(c))))))),
  ) : null;

  return el("section", { class: "card" },
    el("h2", { class: "section-title" }, "📈 מי מדבר הכי הרבה"),
    bars,
    hoursBlock,
  );
}

/* ------------------------------------------------------------------ *
 * Tooltip
 * ------------------------------------------------------------------ */
const tip = $("#tooltip");
function attachTooltip(node, text) {
  const place = (x, y) => {
    tip.textContent = text;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 10)}px`;
  };
  node.addEventListener("mousemove", (e) => place(e.clientX, e.clientY));
  node.addEventListener("focus", () => {
    const r = node.getBoundingClientRect();
    place(r.left + r.width / 2, r.top);
  });
  for (const ev of ["mouseleave", "blur"]) node.addEventListener(ev, () => { tip.hidden = true; });
}

/* ------------------------------------------------------------------ *
 * Share / copy
 * ------------------------------------------------------------------ */
function roastAsText(roast, limitMembers) {
  const members = limitMembers ? roast.members.slice(0, limitMembers) : roast.members;
  const lines = [`🔥 ${roast.group_nickname}`, roast.one_liner, ""];
  for (const m of members) lines.push(`*${m.name}* – ${m.nickname}`, m.roast, "");
  if (limitMembers && roast.members.length > limitMembers) lines.push(`…ועוד ${roast.members.length - limitMembers} קורבנות`, "");
  lines.push(roast.closing_line);
  return lines.join("\n");
}

async function copyRoast(roast) {
  try {
    await navigator.clipboard.writeText(roastAsText(roast));
    toast("הועתק! עכשיו להדביק בקבוצה 😈");
  } catch (_) {
    toast("לא הצלחנו להעתיק. נסו לסמן ולהעתיק ידנית.");
  }
}

async function shareRoast(roast) {
  const full = roastAsText(roast);
  if (navigator.share) {
    try { await navigator.share({ text: full }); } catch (_) { /* user cancelled */ }
    return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(roastAsText(roast, 4))}`, "_blank", "noopener");
}
