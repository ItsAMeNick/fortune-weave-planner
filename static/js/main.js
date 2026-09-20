import charData from "./characters.js";
import classData from "./classes.js";
import paralogueData from "./paralogues.js";

const ROUTES = ["cai", "dietrich", "theodora", "leda"];
const STATS = ["HP", "Str", "Mag", "Spd", "Dex", "Def", "Res", "Lck", "Cha"];
const PROFS = [
  "Sword", "Spear", "Axe", "Bow", "Brawling",
  "White Magic", "Black Magic", "Authority",
  "Infantry", "Rider", "Flier", "Heavy",
];
const TIERS = ["Beginner", "Specialty", "Advanced", "Master"];
const STORE_KEY = "fortunes-weave-planner-v1";

let route = ROUTES[0];
let slotCount = 12;
let mode = "characters"; // which browser the right panel shows
// route -> { party: [{slug, build: {tier: classSlug}} | null], done: {slug: true} }
let plans = {};

// ── boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  loadState();
  buildRouteTabs();
  buildFilters();
  buildRoster();
  buildClassGrid();
  bindControls();
  parseHash();
  render();
  saveState();
});

function blankPlan() {
  return { party: Array(16).fill(null), done: {} };
}

function plan() {
  return plans[route];
}

/**
 * A route's lord is in that route's army by definition, so slot 0 is theirs and
 * cannot be emptied. Their build stays editable — that's the part worth planning.
 */
function ensureLord(r) {
  const party = plans[r].party;
  const at = party.findIndex((m) => m?.slug === r);
  const lord = at >= 0 ? party[at] : { slug: r, build: defaultBuild(r) };
  if (at >= 0) party[at] = null;
  if (party[0] && party[0].slug !== r) {
    const free = party.findIndex((m, i) => i > 0 && !m);
    if (free !== -1) party[free] = party[0];
  }
  party[0] = lord;
}

const isLord = (member) => member.slug === route;

// ── persistence ───────────────────────────────────────────────────────────────
function loadState() {
  for (const r of ROUTES) plans[r] = blankPlan();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (saved.slotCount) slotCount = saved.slotCount;
    if (saved.mode) mode = saved.mode;
    if (saved.route && ROUTES.includes(saved.route)) route = saved.route;
    for (const r of ROUTES) {
      if (!saved.plans?.[r]) continue;
      const p = plans[r];
      p.done = saved.plans[r].done || {};
      (saved.plans[r].party || []).forEach((m, i) => {
        if (m && charData[m.slug]) p.party[i] = { slug: m.slug, build: readBuild(m) };
      });
    }
  } catch {
    // A corrupt or blocked store just means we start from an empty plan.
  }
  document.getElementById("slot-count").value = String(slotCount);
}

function saveState() {
  const note = document.getElementById("save-note");
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ route, slotCount, mode, plans, savedAt: Date.now() })
    );
    note.textContent = `Saved ${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    note.classList.remove("save-note--failed");
  } catch {
    // Private windows and blocked site data refuse storage; say so rather than
    // letting someone believe a plan is being kept.
    note.textContent = "Not saved — this browser blocks local storage";
    note.classList.add("save-note--failed");
  }
}

// ── route tabs ────────────────────────────────────────────────────────────────
function buildRouteTabs() {
  const nav = document.getElementById("route-tabs");
  nav.innerHTML = "";
  for (const r of ROUTES) {
    const lord = charData[r];
    const btn = document.createElement("button");
    btn.className = "route-tab";
    btn.dataset.route = r;
    btn.innerHTML =
      `<img src="${lord?.portrait || ""}" alt="">` +
      `<span class="route-tab__name">${lord?.name || r}</span>` +
      `<span class="route-tab__sub">${lord?.faction || ""}</span>`;
    btn.addEventListener("click", () => setRoute(r));
    nav.appendChild(btn);
  }
}

function setRoute(r) {
  route = r;
  saveState();
  render();
}

// ── build paths ───────────────────────────────────────────────────────────────
function blankBuild() {
  return Object.fromEntries(TIERS.map((t) => [t, ""]));
}

/** Accept both the current {build} shape and the older single {cls} field. */
function readBuild(member) {
  const build = blankBuild();
  if (member.build) {
    for (const tier of TIERS) {
      const slug = member.build[tier];
      if (classData[slug]?.tier === tier) build[tier] = slug;
    }
  } else if (classData[member.cls]) {
    build[classData[member.cls].tier] = member.cls;
  }
  return build;
}

/** The tiers a build actually fills, in progression order. */
function buildSteps(member) {
  return TIERS.filter((t) => classData[member.build[t]]).map((t) => ({
    tier: t,
    slug: member.build[t],
    cls: classData[member.build[t]],
  }));
}

function finalClass(member) {
  const steps = buildSteps(member);
  return steps.length ? steps[steps.length - 1].cls : null;
}

/** Character growth plus the class's own growth modifier, per stat. */
function effectiveGrowths(character, cls) {
  const out = {};
  for (const stat of STATS) {
    const base = character.growths[stat];
    if (typeof base !== "number") continue;
    out[stat] = base + (cls?.growths?.[stat] || 0);
  }
  return out;
}

// ── army slots ────────────────────────────────────────────────────────────────
function buildSlots() {
  const list = document.getElementById("party-slots");
  list.innerHTML = "";
  for (let i = 0; i < slotCount; i++) {
    const node = document.getElementById("slot-tmpl").content.cloneNode(true);
    const li = node.querySelector("li");
    li.dataset.index = i;
    li.querySelector(".slot__remove").addEventListener("click", () => {
      const member = plan().party[i];
      if (member && isLord(member)) return;
      plan().party[i] = null;
      commit();
    });
    const build = li.querySelector(".slot__build");
    for (const tier of TIERS) {
      const row = document.createElement("label");
      row.className = "tier";
      row.innerHTML = `<span class="tier__label" title="${tier}">${tier[0]}</span>`;
      const select = document.createElement("select");
      select.className = "tier__select";
      select.dataset.tier = tier;
      fillClassOptions(select, tier);
      select.addEventListener("change", () => {
        const member = plan().party[i];
        if (member) member.build[tier] = select.value;
        commit();
      });
      const info = document.createElement("button");
      info.className = "tier__info";
      info.textContent = "i";
      info.title = "Class details";
      info.addEventListener("click", (e) => {
        e.preventDefault();
        if (select.value) openClassDetail(select.value);
      });
      row.append(select, info);
      build.appendChild(row);
    }
    list.appendChild(node);
  }
}

function fillClassOptions(select, tier) {
  select.innerHTML = `<option value="">— ${tier.toLowerCase()} —</option>`;
  Object.entries(classData)
    .filter(([, c]) => c.tier === tier)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([slug, c]) => {
      const opt = document.createElement("option");
      opt.value = slug;
      // Tier already implies the level gate; the plan rows spell the numbers out.
      opt.textContent = c.name;
      select.appendChild(opt);
    });
}

function renderSlots() {
  document.getElementById("party-count").textContent =
    `${members().length} / ${slotCount} on ${charData[route]?.name || route}'s route`;

  document.querySelectorAll("#party-slots li").forEach((li) => {
    const i = Number(li.dataset.index);
    const member = plan().party[i];
    const selects = li.querySelectorAll(".tier__select");

    if (!member) {
      li.className = "slot slot--empty";
      li.querySelector(".slot__img").src = "";
      li.querySelector(".slot__name").textContent = "";
      li.querySelector(".slot__join").textContent = "";
      li.querySelector(".slot__final").textContent = "";
      li.querySelector(".slot__class-req").textContent = "";
      selects.forEach((s) => (s.value = ""));
      return;
    }

    const c = charData[member.slug];
    const req = c.routes[route];
    li.className =
      "slot slot--filled" +
      (req ? "" : " slot--unavailable") +
      (isLord(member) ? " slot--locked" : "");
    li.querySelector(".slot__img").src = c.portrait;
    li.querySelector(".slot__img").alt = c.name;
    li.querySelector(".slot__name").textContent = c.name;
    li.querySelector(".slot__join").textContent = isLord(member)
      ? "Route lord — always deployed"
      : req
      ? req.chapter || "Joins later"
      : "Not on this route";
    selects.forEach((s) => (s.value = member.build[s.dataset.tier] || ""));
    li.querySelector(".slot__final").innerHTML = finalClassNote(c, member);
    li.querySelector(".slot__class-req").innerHTML = skillNote(c, member);
  });
}

/** What the build ends as: unit type, movement and the stat swing it brings. */
function finalClassNote(character, member) {
  const cls = finalClass(member);
  if (!cls) return `<span class="dim">No build picked</span>`;
  const bits = [cls.name, cls.unitType, cls.movement ? `Mov ${cls.movement}` : ""].filter(Boolean);
  if (!cls.growths) {
    return `<span class="final">${bits.join(" · ")}</span>
      <span class="dim"> · growths not published</span>`;
  }
  const swing = STATS.filter((stat) => cls.growths[stat])
    .sort((a, b) => Math.abs(cls.growths[b]) - Math.abs(cls.growths[a]))
    .slice(0, 3)
    .map((stat) => `${stat} ${cls.growths[stat] > 0 ? "+" : ""}${cls.growths[stat]}`)
    .join(", ");
  return `<span class="final">${bits.join(" · ")}</span><span class="dim"> · ${swing}</span>`;
}

/**
 * Classes gate on skill ranks (e.g. Axe D). A character with no natural
 * proficiency in that skill still qualifies, but trains it far more slowly —
 * worth flagging before you commit a build to it.
 */
function skillNote(character, member) {
  const steps = buildSteps(member);
  if (!steps.length) return "";
  const owned = new Set(character.proficiencies.map(stripSkill));
  const slow = [];
  for (const step of steps) {
    for (const s of step.cls.skills) {
      if (!owned.has(s.skill) && !slow.some((x) => x.skill === s.skill)) slow.push(s);
    }
  }
  if (!slow.length) {
    return `<span class="ok">✓ every rank is one of their proficiencies</span>`;
  }
  return `<span class="warn">⚠ must train ${slow
    .map((s) => `${s.skill} to ${s.rank}`)
    .join(", ")} — not a proficiency, so skill EXP comes slowly</span>`;
}

const stripSkill = (s) => s.replace(/\s*Skill$/, "");

// ── recruitment plan ──────────────────────────────────────────────────────────
function renderPlan() {
  const list = document.getElementById("plan-list");
  const summary = document.getElementById("plan-summary");
  const empty = document.getElementById("plan-empty");
  list.innerHTML = "";

  const entries = members()
    .map((m) => ({ member: m, char: charData[m.slug], req: charData[m.slug].routes[route] }))
    .sort((a, b) => chapterKey(a.req) - chapterKey(b.req));

  empty.hidden = entries.length > 0;
  summary.innerHTML = "";
  if (!entries.length) return;

  let maxRenown = 0;
  let unavailable = 0;
  for (const e of entries) {
    if (!e.req) { unavailable++; continue; }
    maxRenown = Math.max(
      maxRenown,
      e.req.renown,
      ...buildSteps(e.member).map((step) => step.cls.renown || 0)
    );
  }
  const negotiations = entries.filter((e) => e.req?.negotiation).length;
  const paralogues = entries.filter((e) =>
    e.req?.extra.some((x) => /paralogue/i.test(x))
  ).length;
  const recruitable = entries.filter((e) => !isLord(e.member));
  const done = recruitable.filter((e) => plan().done[e.member.slug]).length;

  summary.innerHTML = [
    chip(`${done}/${recruitable.length}`, "recruited"),
    chip(`${maxRenown}`, "peak Renown needed"),
    negotiations ? chip(`${negotiations}`, "negotiations") : "",
    paralogues ? chip(`${paralogues}`, "paralogue-gated") : "",
    unavailable ? chip(`${unavailable}`, "not on this route", "bad") : "",
  ].join("");

  for (const { member, char, req } of entries) {
    const li = document.createElement("li");
    li.className = "plan-row" + (plan().done[member.slug] ? " plan-row--done" : "");
    if (!req) li.classList.add("plan-row--bad");

    let check;
    if (isLord(member)) {
      check = document.createElement("span");
      check.className = "plan-row__lord";
      check.textContent = "★";
      check.title = "Route lord — no recruitment needed";
      li.classList.add("plan-row--lord");
    } else {
      check = document.createElement("input");
      check.type = "checkbox";
      check.checked = !!plan().done[member.slug];
      check.title = "Mark as recruited";
      check.addEventListener("change", () => {
        if (check.checked) plan().done[member.slug] = true;
        else delete plan().done[member.slug];
        commit();
      });
    }

    const body = document.createElement("div");
    body.className = "plan-row__body";
    if (!req) {
      body.innerHTML =
        `<span class="plan-row__name">${char.name}</span>` +
        `<span class="plan-row__reqs"><em>Cannot be recruited on this route.</em></span>`;
    } else {
      const bits = [];
      if (req.support) bits.push(`Support Lv ${req.support}`);
      if (req.renown) bits.push(`${req.renown} Renown`);
      if (req.negotiation) bits.push(`Negotiation (${req.negotiation})`);
      for (const x of req.extra) bits.push(x);
      const steps = buildSteps(member);
      if (steps.length) {
        bits.push(
          steps.map((step) => `${step.cls.name} (Lv ${step.cls.level})`).join(" → ")
        );
      }
      body.innerHTML =
        `<span class="plan-row__name">${char.name}</span>` +
        `<span class="plan-row__chapter">${req.chapter || "—"}</span>` +
        `<span class="plan-row__reqs">${bits.length ? bits.join(" · ") : "Joins automatically"}</span>`;
    }

    const gifts = document.createElement("span");
    gifts.className = "plan-row__gift";
    gifts.textContent = char.likes.slice(0, 2).join(", ");
    gifts.title = `Likes: ${char.likes.join(", ") || "—"}\nInterests: ${char.interests.join(", ") || "—"}`;

    li.append(check, body, gifts);
    list.appendChild(li);
  }
}

function chip(value, label, kind = "") {
  return `<span class="chip ${kind}"><b>${value}</b>${label}</span>`;
}

function chapterKey(req) {
  if (!req) return 9999;
  const c = (req.chapter || "").toLowerCase();
  let part = /prologue/.test(c) ? 0 : 1;
  const pm = c.match(/part\s+(i{1,3}|iv|\d)/);
  if (pm) part = { i: 1, ii: 2, iii: 3, iv: 4 }[pm[1]] ?? Number(pm[1]) ?? 1;
  const ch = c.match(/chapter\s*(\d+)/);
  return part * 100 + (ch ? Number(ch[1]) : 50);
}

// ── required paralogues ───────────────────────────────────────────────────────
/** Recruitment lines read "Clear Cai's Paralogue" - pull the owner out of them. */
function requiredParalogues() {
  const needed = new Map();
  for (const m of members()) {
    const req = charData[m.slug].routes[route];
    if (!req) continue;
    for (const line of req.extra) {
      const owner = line.match(/(\w+)'s Paralogue/);
      if (!owner) continue;
      const key = owner[1].trim().toLowerCase().replace(/\s+/g, "-");
      if (!paralogueData[key]) continue;
      if (!needed.has(key)) needed.set(key, []);
      needed.get(key).push(charData[m.slug].name);
    }
  }
  return needed;
}

function renderParalogues() {
  const box = document.getElementById("paralogue-list");
  const needed = requiredParalogues();
  if (!needed.size) {
    box.innerHTML = `<p class="hint">No one in this army is gated behind a paralogue.</p>`;
    return;
  }
  box.innerHTML = [...needed.entries()]
    .map(([key, who]) => {
      const p = paralogueData[key];
      const here = p.routes[route];
      const when = here
        ? `<span class="para__when">${here.chapter} · ${here.window}</span>`
        : `<span class="para__when para__when--bad">Not available on this route</span>`;
      const renown = p.rewards.find((r) => /renown/i.test(r)) || "";
      return `<div class="para-row${here ? "" : " para-row--bad"}">
        <div>
          <span class="para__name">${p.owner}'s Paralogue</span>
          <span class="para__title">${p.title}</span>
          <span class="para__for">Unlocks: ${who.join(", ")}</span>
        </div>
        <div class="para__meta">${when}<span class="para__reward">${renown}</span></div>
      </div>`;
    })
    .join("");
}

// ── gift cheat sheet ──────────────────────────────────────────────────────────
function renderGifts() {
  const box = document.getElementById("gift-sheet");
  const list = members();
  if (!list.length) {
    box.innerHTML = `<p class="hint">Your army's likes and interests show up here — that's what gifts to buy.</p>`;
    return;
  }
  box.innerHTML = list
    .map((m) => charData[m.slug])
    .map(
      (c) => `<div class="gift-row">
        <img src="${c.portrait}" alt="">
        <div>
          <span class="gift-row__name">${c.name}</span>
          <span class="gift-row__likes"><b>Likes</b> ${c.likes.join(", ") || "—"}</span>
          <span class="gift-row__likes"><b>Interests</b> ${c.interests.join(", ") || "—"}</span>
        </div>
      </div>`
    )
    .join("");
}

// ── tallies ───────────────────────────────────────────────────────────────────
function renderTallies() {
  const army = members().map((m) => charData[m.slug]);

  const profBody = document.getElementById("prof-body");
  profBody.innerHTML = PROFS.map((p) => {
    const who = army.filter((c) => c.proficiencies.map(stripSkill).includes(p));
    const cls = who.length === 0 ? "gap" : who.length >= 3 ? "good" : "";
    return `<tr class="tally-${cls}">
      <th>${p}</th>
      <td class="tally__count">${who.length}</td>
      <td class="tally__who">${who.map((c) => c.name).join(", ")}</td>
    </tr>`;
  }).join("");

  const built = members().map((m) => ({
    char: charData[m.slug],
    growths: effectiveGrowths(charData[m.slug], finalClass(m)),
  }));
  const withClass = members().filter((m) => finalClass(m)?.growths).length;
  document.getElementById("growth-mode").textContent = withClass
    ? `${withClass} of ${army.length} include class growth`
    : "";

  const growthBody = document.getElementById("growth-body");
  growthBody.innerHTML = STATS.map((s) => {
    const values = built.map((b) => b.growths[s]).filter((v) => typeof v === "number");
    const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
    return `<tr>
      <th>${s}</th>
      <td class="tally__bar"><span style="width:${Math.min(100, avg * 1.6)}%"></span></td>
      <td class="tally__count">${avg ? `${avg}%` : "—"}</td>
    </tr>`;
  }).join("");
}

// ── roster ────────────────────────────────────────────────────────────────────
function buildRoster() {
  const grid = document.getElementById("roster-grid");
  grid.innerHTML = "";
  for (const [slug, c] of Object.entries(charData)) {
    const card = document.createElement("div");
    card.className = "char-card";
    card.dataset.slug = slug;

    const dots = ROUTES.map((r) => {
      const req = c.routes[r];
      const title = req
        ? `${charData[r].name}: ${[req.chapter, req.support && `Support Lv ${req.support}`,
            req.renown && `${req.renown} Renown`].filter(Boolean).join(" · ")}`
        : `${charData[r].name}: not recruitable`;
      return `<i class="dot dot--${r} ${req ? "" : "dot--off"}" title="${title}"></i>`;
    }).join("");

    card.innerHTML = `
      <img class="char-card__img" src="${c.portrait}" alt="${c.name}" loading="lazy">
      <div class="char-card__info">
        <span class="char-card__name">${c.name}</span>
        <span class="char-card__faction">${c.faction || ""}</span>
        <div class="char-card__routes">${dots}</div>
        <span class="char-card__req"></span>
      </div>
      <button class="char-card__detail" title="Details">i</button>`;

    card.addEventListener("click", (e) => {
      if (e.target.closest(".char-card__detail")) openDetail(slug);
      else addMember(slug);
    });
    grid.appendChild(card);
  }
}

function renderRoster() {
  const query = document.getElementById("search").value.trim().toLowerCase();
  const faction = document.getElementById("faction-filter").value;
  const prof = document.getElementById("prof-filter").value;
  const routeOnly = document.getElementById("this-route-only").checked;
  const freeOnly = document.getElementById("free-only").checked;
  const sortBy = document.getElementById("sort-by").value;
  const picked = new Set(members().map((m) => m.slug));

  const cards = Array.from(document.querySelectorAll(".char-card"));
  for (const card of cards) {
    const slug = card.dataset.slug;
    const c = charData[slug];
    const req = c.routes[route];

    const show =
      (!query || c.name.toLowerCase().includes(query)) &&
      (!faction || c.faction === faction) &&
      (!prof || c.proficiencies.map(stripSkill).includes(prof)) &&
      (!routeOnly || !!req) &&
      (!freeOnly || (req && !req.support && !req.renown && !req.negotiation && !req.extra.length));
    card.hidden = !show;
    card.classList.toggle("char-card--picked", picked.has(slug));

    card.querySelector(".char-card__req").textContent = req
      ? [req.chapter, req.support && `Sup ${req.support}`, req.renown && `${req.renown} Renown`,
         req.negotiation && `Negotiation`].filter(Boolean).join(" · ")
      : "Not on this route";
  }

  const rank = {
    chapter: (c) => chapterKey(c.routes[route]),
    renown: (c) => (c.routes[route] ? c.routes[route].renown : 999),
    name: () => 0,
  }[sortBy];
  cards
    .sort((a, b) => {
      const ca = charData[a.dataset.slug];
      const cb = charData[b.dataset.slug];
      return rank(ca) - rank(cb) || ca.name.localeCompare(cb.name);
    })
    .forEach((card) => card.parentNode.appendChild(card));
}

function addMember(slug) {
  const party = plan().party;
  if (party.some((m) => m?.slug === slug)) return;
  const free = party.findIndex((m, i) => i < slotCount && !m);
  if (free === -1) return;
  party[free] = { slug, build: defaultBuild(slug) };
  commit();
}

/** Seed the build with Game8's recommended progression, each class in its own tier. */
function defaultBuild(slug) {
  const build = blankBuild();
  for (const name of charData[slug].classPath) {
    const found = Object.entries(classData).find(([, c]) => c.name === name);
    if (found && !build[found[1].tier]) build[found[1].tier] = found[0];
  }
  return build;
}

// ── class browser ─────────────────────────────────────────────────────────────
const UNIT_TYPES = () =>
  [...new Set(Object.values(classData).map((c) => c.unitType).filter(Boolean))].sort();

const CLASS_SKILLS = () =>
  [...new Set(Object.values(classData).flatMap((c) => c.skills.map((s) => s.skill)))].sort();

/**
 * Who suits a class, by two signals kept separate because they mean different
 * things: the class guide naming it in a character's recommended progression,
 * and the character already being proficient in every rank it gates on.
 * Both lists are ordered by growth synergy — how much the class's growth
 * modifier pushes the stats that character is already above their own average in.
 */
function classFits(clsSlug) {
  const cls = classData[clsSlug];
  const synergy = (character) => {
    if (!cls.growths || !Object.keys(character.growths).length) return 0;
    const values = STATS.map((s) => character.growths[s]).filter((v) => typeof v === "number");
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return STATS.reduce(
      (sum, s) => sum + (cls.growths[s] || 0) * ((character.growths[s] ?? mean) - mean),
      0
    );
  };

  const recommended = [];
  const natural = [];
  for (const [slug, character] of Object.entries(charData)) {
    if (character.classPath.includes(cls.name)) recommended.push(slug);
    else if (
      cls.skills.length &&
      cls.skills.every((k) => character.proficiencies.map(stripSkill).includes(k.skill))
    ) {
      natural.push(slug);
    }
  }
  const bySynergy = (a, b) => synergy(charData[b]) - synergy(charData[a]);
  recommended.sort(bySynergy);
  natural.sort(bySynergy);

  // Nothing to go on: fall back to the growth fit alone.
  const fallback =
    recommended.length || natural.length
      ? []
      : Object.keys(charData)
          .sort(bySynergy)
          .filter((slug) => synergy(charData[slug]) > 0)
          .slice(0, 6);

  return { recommended, natural, fallback };
}

function portrait(slug, kind) {
  const c = charData[slug];
  const why = {
    recommended: "recommended for this class",
    natural: "already proficient in every rank it needs",
    fallback: "growths line up with what this class boosts",
  }[kind];
  return `<button class="mini mini--${kind}" data-char="${slug}" title="${c.name} — ${why}">
    <img src="${c.portrait}" alt="${c.name}" loading="lazy"></button>`;
}

/** Portraits for a class card: recommended first, topped up with natural fits. */
function fitStrip(clsSlug, limit = 6) {
  const { recommended, natural, fallback } = classFits(clsSlug);
  const picks = [
    ...recommended.map((s) => [s, "recommended"]),
    ...natural.map((s) => [s, "natural"]),
    ...fallback.map((s) => [s, "fallback"]),
  ];
  const shown = picks.slice(0, limit).map(([s, kind]) => portrait(s, kind));
  const extra = picks.length - shown.length;
  return `<div class="fit-strip">${shown.join("")}${
    extra > 0 ? `<span class="fit-more">+${extra}</span>` : ""
  }</div>`;
}

function buildClassGrid() {
  const grid = document.getElementById("class-grid");
  grid.innerHTML = "";
  const order = Object.fromEntries(TIERS.map((t, i) => [t, i]));
  Object.entries(classData)
    .sort(
      (a, b) =>
        order[a[1].tier] - order[b[1].tier] || a[1].name.localeCompare(b[1].name)
    )
    .forEach(([slug, c]) => {
      const card = document.createElement("div");
      card.className = "class-card";
      card.dataset.slug = slug;
      card.innerHTML = `
        <img class="class-card__icon" src="${c.icon}" alt="" loading="lazy">
        <div class="class-card__info">
          <span class="class-card__name">${c.name}</span>
          <span class="class-card__meta">
            <i class="tier-dot tier-dot--${c.tier.toLowerCase()}"></i>${c.tier}
            ${c.unitType ? ` · ${c.unitType}` : ""}${c.movement ? ` · Mov ${c.movement}` : ""}
          </span>
          <span class="class-card__req">Lv ${c.level}${
            c.renown ? ` · ${c.renown} Renown` : ""
          }${c.skills.length ? ` · ${c.skills.map((k) => `${k.skill} ${k.rank}`).join(", ")}` : ""}</span>
          ${fitStrip(slug)}
        </div>`;
      card.addEventListener("click", (e) => {
        const mini = e.target.closest(".mini");
        if (mini) openDetail(mini.dataset.char);
        else openClassDetail(slug);
      });
      grid.appendChild(card);
    });
}

/** Which army members have this class somewhere in their build path. */
function plannedBy(clsSlug) {
  return members()
    .filter((m) => TIERS.some((t) => m.build[t] === clsSlug))
    .map((m) => charData[m.slug].name);
}

function renderClassGrid() {
  const query = document.getElementById("class-search").value.trim().toLowerCase();
  const tier = document.getElementById("tier-filter").value;
  const unit = document.getElementById("unit-filter").value;
  const skill = document.getElementById("class-skill-filter").value;
  const inBuild = document.getElementById("in-build-only").checked;

  document.querySelectorAll(".class-card").forEach((card) => {
    const c = classData[card.dataset.slug];
    const planned = plannedBy(card.dataset.slug);
    card.hidden = !(
      (!query || c.name.toLowerCase().includes(query)) &&
      (!tier || c.tier === tier) &&
      (!unit || c.unitType === unit) &&
      (!skill || c.skills.some((k) => k.skill === skill)) &&
      (!inBuild || planned.length)
    );
    card.classList.toggle("class-card--planned", planned.length > 0);
    card.title = planned.length ? `Planned by ${planned.join(", ")}` : "";
  });
}

function fitSection(title, note, slugs, kind) {
  if (!slugs.length) return "";
  return `<p class="section-title">${title} <span class="section-note">— ${note}</span></p>
    <div class="detail__fits">${slugs
      .map((s) => `<span class="fit-name">${portrait(s, kind)}${charData[s].name}</span>`)
      .join("")}</div>`;
}

function openClassDetail(slug) {
  const c = classData[slug];
  const { recommended, natural, fallback } = classFits(slug);
  const planned = plannedBy(slug);

  const statRows = c.growths
    ? STATS.map(
        (stat) => `<tr><th>${stat}</th>
          <td class="tally__delta ${c.bonuses[stat] > 0 ? "up" : c.bonuses[stat] < 0 ? "down" : ""}">${
            c.bonuses[stat] ? (c.bonuses[stat] > 0 ? "+" : "") + c.bonuses[stat] : "—"
          }</td>
          <td class="tally__bar"><span style="width:${Math.min(100, Math.abs(c.growths[stat]) * 4)}%"></span></td>
          <td class="tally__delta ${c.growths[stat] > 0 ? "up" : c.growths[stat] < 0 ? "down" : ""}">${
            c.growths[stat] ? (c.growths[stat] > 0 ? "+" : "") + c.growths[stat] : "—"
          }</td></tr>`
      ).join("")
    : `<tr><td class="dim">No stat data published for this class yet.</td></tr>`;

  const reqs = [
    c.tier === "Master" ? "No license — Master tier" : `${c.tier} License`,
    `Level ${c.level}`,
    c.renown ? `Renown Lv ${c.renown}` : "",
    `Unlocks in Part ${c.part}`,
  ].filter(Boolean);

  showModal(`
    <button class="detail__close" title="Close">&#x2715;</button>
    <div class="detail__head">
      <img class="detail__class-icon" src="${c.icon}" alt="">
      <div>
        <h2>${c.name}</h2>
        <p class="detail__faction">
          <i class="tier-dot tier-dot--${c.tier.toLowerCase()}"></i>${c.tier} tier
          ${c.unitType ? ` · ${c.unitType}` : ""}${c.movement ? ` · Movement ${c.movement}` : ""}
        </p>
        <p class="detail__profs">${reqs.map((r) => `<span class="pill">${r}</span>`).join("")}</p>
        <p class="detail__profs">${c.skills
          .map(
            (k) =>
              `<span class="pill pill--skill">${k.skill} ${k.rank}<em>${k.kind}</em></span>`
          )
          .join("") || `<span class="dim">No skill requirement</span>`}</p>
      </div>
    </div>
    <div class="detail__cols">
      <div>
        <p class="section-title">Stat Bonus &amp; Growth</p>
        <table class="detail__growths"><tbody>${statRows}</tbody></table>
        ${c.growths ? `<p class="hint">Flat bonus, then the growth added to the unit's own.</p>` : ""}
      </div>
      <div>
        <p class="section-title">Abilities</p>
        ${
          c.abilities.class.length
            ? `<p class="detail__likes"><b>Class</b> ${c.abilities.class.join(", ")}</p>`
            : ""
        }
        ${
          c.abilities.master.length
            ? `<p class="detail__likes"><b>Mastery</b> ${c.abilities.master.join(", ")}</p>`
            : ""
        }
        ${c.skillExp ? `<p class="detail__likes"><b>Skill EXP</b> ${c.skillExp}</p>` : ""}
        <p class="section-title">In This Army</p>
        <p class="detail__likes">${
          planned.length ? planned.join(", ") : `<span class="dim">Nobody is building into it.</span>`
        }</p>
      </div>
    </div>
    ${fitSection("Recommended For", "the class guide puts it in their progression", recommended, "recommended")}
    ${fitSection("Natural Fits", "every rank it needs is already a proficiency", natural, "natural")}
    ${fitSection("Best Growth Synergy", "their strong growths are what this class boosts", fallback, "fallback")}
    ${
      recommended.length || natural.length || fallback.length
        ? ""
        : `<p class="hint">Nobody stands out for this class yet.</p>`
    }`);

  document.querySelectorAll("#detail .mini").forEach((mini) => {
    mini.addEventListener("click", () => openDetail(mini.dataset.char));
  });
}

// ── detail modal ──────────────────────────────────────────────────────────────
function showModal(html) {
  const box = document.getElementById("detail");
  box.innerHTML = html;
  box.querySelector(".detail__close").addEventListener("click", closeDetail);
  box.scrollTop = 0;
  document.getElementById("detail-backdrop").hidden = false;
}

function openDetail(slug) {
  const c = charData[slug];
  const box = document.getElementById("detail");

  // If they're already in this route's army, show what their build does to growths.
  const member = members().find((m) => m.slug === slug);
  const cls = member ? finalClass(member) : null;
  const effective = member ? effectiveGrowths(c, cls) : null;
  const growths = STATS.map((s) => {
    const base = c.growths[s];
    const total = effective?.[s];
    const delta = cls?.growths?.[s] || 0;
    return `<tr><th>${s}</th>
      <td class="tally__bar"><span style="width:${Math.min(100, (total ?? base ?? 0) * 1.4)}%"></span></td>
      <td class="tally__count">${base ?? "—"}%</td>
      ${
        delta
          ? `<td class="tally__delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${delta}</td>
             <td class="tally__count">${total}%</td>`
          : effective
          ? `<td class="tally__delta"></td><td class="tally__count dim">${total}%</td>`
          : ""
      }</tr>`;
  }).join("");
  const growthHead = cls?.growths
    ? `<p class="hint">Base growth, then ${cls.name}'s modifier and the total.</p>`
    : "";

  const routeRows = ROUTES.map((r) => {
    const req = c.routes[r];
    if (!req) {
      return `<tr class="plan-row--bad"><th>${charData[r].name}</th><td colspan="2">Not recruitable</td></tr>`;
    }
    const bits = [
      req.support && `Support Lv ${req.support}`,
      req.renown && `${req.renown} Renown`,
      req.negotiation && `Negotiation (${req.negotiation})`,
      ...req.extra,
    ].filter(Boolean);
    return `<tr><th>${charData[r].name}</th><td>${req.chapter || "—"}</td>
      <td>${bits.join(" · ") || "Joins automatically"}</td></tr>`;
  }).join("");

  const path = c.classPath
    .map((name) => {
      const found = Object.entries(classData).find(([, x]) => x.name === name);
      const entry = found?.[1];
      return entry
        ? `<span class="path-step" data-class="${found[0]}"><b>${entry.name}</b>${entry.tier} · Lv${entry.level}${
            entry.renown ? ` · ${entry.renown} Renown` : ""
          }${entry.unitType ? ` · ${entry.unitType}` : ""}</span>`
        : `<span class="path-step"><b>${name}</b></span>`;
    })
    .join('<i class="path-arrow">→</i>');

  showModal(`
    <button class="detail__close" title="Close">&#x2715;</button>
    <div class="detail__head">
      <img src="${c.portrait}" alt="${c.name}">
      <div>
        <h2>${c.name}</h2>
        <p class="detail__faction">${c.faction}</p>
        <p class="detail__ability"><b>${c.ability?.name || c.personalSkill || ""}</b>
          ${c.ability?.desc || ""}</p>
        <p class="detail__profs">${c.proficiencies.map((p) => `<span class="pill">${p}</span>`).join("")}</p>
      </div>
    </div>
    <div class="detail__cols">
      <div>
        <p class="section-title">Growth Rates</p>
        <table class="detail__growths"><tbody>${growths}</tbody></table>
        ${growthHead}
      </div>
      <div>
        <p class="section-title">Likes &amp; Interests</p>
        <p class="detail__likes"><b>Likes</b> ${c.likes.join(", ") || "—"}</p>
        <p class="detail__likes"><b>Interests</b> ${c.interests.join(", ") || "—"}</p>
        <p class="section-title">Recommended Class Path</p>
        <div class="detail__path">${path}</div>
      </div>
    </div>
    <p class="section-title">Recruitment by Route</p>
    <table class="detail__routes"><tbody>${routeRows}</tbody></table>
    <button class="btn btn--wide" id="detail-add"${member ? " disabled" : ""}>${
      member ? `Already in ${charData[route].name}'s army` : `Add to ${charData[route].name}'s army`
    }</button>`);

  box.querySelector("#detail-add").addEventListener("click", () => {
    addMember(slug);
    closeDetail();
  });
  box.querySelectorAll(".path-step[data-class]").forEach((step) => {
    step.addEventListener("click", () => openClassDetail(step.dataset.class));
  });
}

function closeDetail() {
  document.getElementById("detail-backdrop").hidden = true;
}

// ── controls ──────────────────────────────────────────────────────────────────
function buildFilters() {
  const factions = [...new Set(Object.values(charData).map((c) => c.faction).filter(Boolean))].sort();
  const factionSel = document.getElementById("faction-filter");
  for (const f of factions) factionSel.add(new Option(f, f));

  const profSel = document.getElementById("prof-filter");
  for (const p of PROFS) profSel.add(new Option(p, p));

  const tierSel = document.getElementById("tier-filter");
  for (const t of TIERS) tierSel.add(new Option(t, t));

  const unitSel = document.getElementById("unit-filter");
  for (const u of UNIT_TYPES()) unitSel.add(new Option(u, u));

  const skillSel = document.getElementById("class-skill-filter");
  for (const k of CLASS_SKILLS()) skillSel.add(new Option(k, k));
}

function setMode(next) {
  mode = next;
  saveState();
  render();
}

function bindControls() {
  for (const id of ["search", "faction-filter", "prof-filter", "sort-by", "this-route-only", "free-only"]) {
    const el = document.getElementById(id);
    el.addEventListener(el.tagName === "INPUT" && el.type === "text" ? "input" : "change", renderRoster);
  }

  for (const id of ["class-search", "tier-filter", "unit-filter", "class-skill-filter", "in-build-only"]) {
    const el = document.getElementById(id);
    el.addEventListener(el.type === "text" ? "input" : "change", renderClassGrid);
  }

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  document.getElementById("slot-count").addEventListener("change", (e) => {
    slotCount = Number(e.target.value);
    for (const r of ROUTES) {
      plans[r].party = plans[r].party.map((m, i) => (i < slotCount ? m : null));
    }
    buildSlots();
    commit();
  });

  document.getElementById("copy-from").addEventListener("change", (e) => {
    const from = e.target.value;
    e.target.value = "";
    if (!from) return;
    // The source route's lord belongs to that route, not this one.
    plan().party = plans[from].party.map((m) =>
      m && m.slug !== from ? { ...m, build: { ...m.build } } : null
    );
    ensureLord(route);
    commit();
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    plans[route] = blankPlan();
    ensureLord(route);
    commit();
  });

  document.getElementById("btn-share").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(location.href);
      flash(e.target, "Copied!");
    } catch {
      flash(e.target, location.hash);
    }
  });

  document.getElementById("btn-undo").addEventListener("click", () => {
    plans[replaced.route] = replaced.plan;
    route = replaced.route;
    replaced = null;
    history.replaceState(null, "", location.pathname + location.search);
    commit();
  });

  document.getElementById("btn-undo-dismiss").addEventListener("click", () => {
    replaced = null;
    commit();
  });

  document.getElementById("detail-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "detail-backdrop") closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });
  window.addEventListener("hashchange", () => {
    parseHash();
    render();
  });
}

/** Offer the other three routes as a starting point for this one. */
function renderCopyMenu() {
  const select = document.getElementById("copy-from");
  select.innerHTML = "<option value=''>Copy army from…</option>";
  for (const r of ROUTES) {
    if (r === route) continue;
    const size = plans[r].party.slice(0, slotCount).filter(Boolean).length;
    const opt = new Option(`${charData[r].name} (${size})`, r);
    opt.disabled = size === 0;
    select.add(opt);
  }
}

function flash(button, message) {
  const original = button.textContent;
  button.textContent = message;
  setTimeout(() => (button.textContent = original), 1200);
}

// ── URL hash ──────────────────────────────────────────────────────────────────
function updateHash() {
  const encoded = members()
    .map((m) => {
      const path = TIERS.map((t) => m.build[t] || "").join(".").replace(/\.+$/, "");
      return path ? `${m.slug}:${path}` : m.slug;
    })
    .join("+");
  history.replaceState(null, "", `#${route}${encoded ? "/" + encoded : ""}`);
}

let replaced = null; // the plan a shared link pushed aside, kept for one undo

function parseHash() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (!hash) return;
  const [r, list] = hash.split("/");
  if (!ROUTES.includes(r)) return;
  route = r;
  if (list === undefined) return;

  // Remember what was saved, in case this link is an old bookmark.
  const previous = plans[r];
  const hadPlan = previous.party.some((m, i) => m && i > 0);
  plans[r] = blankPlan();
  list.split("+").filter(Boolean).forEach((token, i) => {
    const [slug, path] = token.split(":");
    if (!charData[slug] || i >= slotCount) return;
    const build = blankBuild();
    (path || "").split(".").forEach((clsSlug, tierIndex) => {
      if (classData[clsSlug]?.tier === TIERS[tierIndex]) build[TIERS[tierIndex]] = clsSlug;
    });
    plans[r].party[i] = { slug, build };
  });

  const sameAsSaved =
    JSON.stringify(previous.party.map((m) => m?.slug ?? null)) ===
    JSON.stringify(plans[r].party.map((m) => m?.slug ?? null));
  if (hadPlan && !sameAsSaved) {
    plans[r].done = previous.done;
    replaced = { route: r, plan: previous };
  }
}

function renderUndoBanner() {
  const banner = document.getElementById("undo-banner");
  banner.hidden = !replaced;
  if (!replaced) return;
  document.getElementById("undo-text").textContent =
    `This link's army replaced the plan you had saved for ${charData[replaced.route].name}'s route.`;
}

// ── render ────────────────────────────────────────────────────────────────────
function renderMode() {
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("mode-btn--active", btn.dataset.mode === mode);
  });
  document.querySelectorAll(".filters[data-for]").forEach((f) => {
    f.hidden = f.dataset.for !== mode;
  });
  document.getElementById("roster-grid").hidden = mode !== "characters";
  document.getElementById("class-grid").hidden = mode !== "classes";
}

function members() {
  return plan().party.slice(0, slotCount).filter(Boolean);
}

function commit() {
  saveState();
  render();
}

function render() {
  ROUTES.forEach(ensureLord);
  document.body.dataset.route = route;
  document.querySelectorAll(".route-tab").forEach((tab) => {
    tab.classList.toggle("route-tab--active", tab.dataset.route === route);
  });
  renderCopyMenu();
  if (document.querySelectorAll("#party-slots li").length !== slotCount) buildSlots();
  renderSlots();
  renderPlan();
  renderParalogues();
  renderGifts();
  renderTallies();
  renderRoster();
  renderClassGrid();
  renderMode();
  renderUndoBanner();
  updateHash();
}
