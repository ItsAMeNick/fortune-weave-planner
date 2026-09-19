#!/usr/bin/env python3
"""Turn the cached Game8 pages in raw/ into static/js/characters.js + classes.js."""
import html as htmllib
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "static", "js")

ROUTES = ["cai", "dietrich", "theodora", "leda"]
STATS = ["HP", "Str", "Mag", "Spd", "Dex", "Def", "Res", "Lck", "Cha"]


def read(*parts):
    with open(os.path.join(RAW, *parts), encoding="utf-8") as f:
        return f.read()


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def tables(doc):
    return re.findall(r"<table.*?</table>", doc, re.S)


def find_table(doc, *needles):
    for t in tables(doc):
        if all(n in t for n in needles):
            return t
    return None


def text(fragment):
    """Strip tags, keeping <br>/<hr>/<div> boundaries as line breaks."""
    s = re.sub(r"<(br|hr)[^>]*>", "\n", fragment)
    s = re.sub(r"</(div|p|li|tr)>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = htmllib.unescape(s)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in s.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def rows(table):
    return re.findall(r"<tr.*?</tr>", table, re.S)


def cells(row):
    """[(text, colspan)] for each td/th in the row."""
    out = []
    for m in re.finditer(r"<t[dh]([^>]*)>(.*?)</t[dh]>", row, re.S):
        span = re.search(r'colspan=["\']?(\d+)', m.group(1))
        out.append((text(m.group(2)), int(span.group(1)) if span else 1))
    return out


def img_src(fragment):
    m = re.search(r"data-src='([^']+)'", fragment)
    return m.group(1) if m else ""


# ─── recruitment requirements, per route ──────────────────────────────────────
def parse_requirement(cell):
    """'・Part I Chapter 4 / ・Support Lv 3 / ・9 Renown / ・Clear X' -> dict."""
    if not cell or cell.strip() in {"-", "—", "?"}:
        return None
    lines = [ln.lstrip("・･•").strip().rstrip(".") for ln in cell.split("\n")]
    lines = [ln for ln in lines if ln]
    req = {"chapter": "", "support": 0, "renown": 0, "negotiation": "", "extra": []}
    for ln in lines:
        low = ln.lower()
        m = re.search(r"support lv\.?\s*(\d+)", low)
        if m:
            req["support"] = int(m.group(1))
            continue
        m = re.search(r"(\d+)\s*renown", low)
        if m:
            req["renown"] = int(m.group(1))
            continue
        m = re.search(r"negotiation\s*\(([^)]+)\)", ln, re.I)
        if m:
            req["negotiation"] = m.group(1).strip()
            continue
        if re.search(r"chapter|prologue|part\s+[ivx\d]", low) and not req["chapter"]:
            req["chapter"] = ln
            continue
        req["extra"].append(ln)
    return req


def chapter_sort_key(req):
    """Rough ordering so the recruit plan can be listed in play order."""
    if not req or not req["chapter"]:
        return (9, 99)
    c = req["chapter"].lower()
    part = 0 if "prologue" in c else 1
    m = re.search(r"part\s+(i{1,3}|iv|\d)", c)
    if m:
        roman = {"i": 1, "ii": 2, "iii": 3, "iv": 4}
        part = roman.get(m.group(1), int(m.group(1)) if m.group(1).isdigit() else 1)
    m = re.search(r"chapter\s*(\d+)", c)
    return (part, int(m.group(1)) if m else 50)


def parse_recruitment():
    table = find_table(read("recruitment.html"), "Cai's Route", "Dietrich's Route")
    out = {}
    for row in rows(table)[1:]:
        cs = cells(row)
        if len(cs) < 2:
            continue
        name = cs[0][0].strip()
        if not name or name == "Character":
            continue
        # A single wide cell means the same requirement across every route.
        values = []
        for txt, span in cs[1:]:
            values.extend([txt] * span)
        values = (values + [""] * 4)[:4]
        out[slugify(name)] = {
            "name": name,
            "routes": {r: parse_requirement(v) for r, v in zip(ROUTES, values)},
        }
    return out


# ─── roster: portraits, likes, interests ──────────────────────────────────────
def parse_roster():
    table = find_table(read("characters.html"), "Likes and Interests")
    out = {}
    for row in rows(table)[1:]:
        cs = re.findall(r"<td.*?</td>", row, re.S)
        if len(cs) < 3:
            continue
        name = text(cs[0]).strip()
        if not name:
            continue
        body = text(cs[2])
        out[slugify(name)] = {
            "name": name,
            "portrait": img_src(cs[0]),
            "likes": split_list(body, "Likes"),
            "interests": split_list(body, "Interests"),
        }
    return out


def split_list(body, label):
    m = re.search(rf"{label}\s*:\s*(.*)", body, re.I)
    if not m:
        return []
    value = m.group(1).strip()
    if value.lower() in {"none", "-", "n/a"}:
        return []
    return [p.strip() for p in value.split(",") if p.strip()]


# ─── per-character pages: growths, faction, personal ability ─────────────────
def parse_character_page(slug):
    path = os.path.join(RAW, "chars", f"{slug}.html")
    if not os.path.exists(path):
        return {}
    doc = read("chars", f"{slug}.html")
    info = {}

    profile = find_table(doc, "Faction", "Likes")
    if profile:
        body = text(profile).split("\n")
        if "Faction" in body:
            idx = body.index("Faction")
            if idx + 1 < len(body):
                info["faction"] = body[idx + 1]

    growth = find_table(doc, "Stat Growth")
    if growth:
        growths = {}
        for row in rows(growth):
            label = re.search(r"<th[^>]*>(.*?)</th>", row, re.S)
            value = re.search(r"class='a-label'>(\d+)<", row)
            if label and value:
                key = text(label.group(1)).strip()
                if key in STATS:
                    growths[key] = int(value.group(1))
        if growths:
            info["growths"] = growths

    m = re.search(r"Personal Ability(.*?)(?:<h2|Related Guides)", doc, re.S)
    if m:
        t = find_table(m.group(1), "<t")
        if t:
            body = [ln for ln in text(t).split("\n") if ln]
            if body:
                info["ability"] = {"name": body[0], "desc": " ".join(body[1:2])}
    return info


# ─── best-classes page: preferred progression, personal skill, proficiencies ──
def parse_best_classes():
    table = find_table(read("best-classes.html"), "Preferred Class Progression")
    out = {}
    for row in rows(table)[1:]:
        cs = re.findall(r"<td.*?</td>", row, re.S)
        if len(cs) < 3:
            continue
        name = text(cs[0]).strip()
        if not name:
            continue
        progression = [p.strip() for p in text(cs[1]).split("\n") if p.strip() and p.strip() != "▼"]
        body = text(cs[2])
        skill = re.search(r"Personal Skill:\s*\n?(.*)", body)
        profs = re.search(r"Proficiencies:\s*\n?(.*)", body, re.S)
        out[slugify(name)] = {
            "classPath": progression,
            "personalSkill": skill.group(1).strip() if skill else "",
            "proficiencies": [
                p.strip() for p in (profs.group(1).split("\n") if profs else []) if p.strip()
            ],
        }
    return out


# ─── classes ─────────────────────────────────────────────────────────────────
def parse_classes():
    doc = read("classes.html")
    out = {}
    for table in tables(doc):
        if "Requirements" not in table or "Abilities" not in table:
            continue
        for row in rows(table)[1:]:
            cs = re.findall(r"<td.*?</td>", row, re.S)
            if len(cs) < 3:
                continue
            name = text(cs[0]).strip()
            if not name:
                continue
            reqs, abil = text(cs[1]), text(cs[2])
            skills = parse_skill_reqs(cs[1])
            slug = slugify(name)
            out[slug] = {
                "name": name,
                "icon": img_src(cs[0]),
                "tier": match(r"License\s*:\s*(\w+)", reqs) or "Master",
                "part": int(match(r"Unlock Part:\s*(\d+)", reqs) or 1),
                "level": int(match(r"Ideal\s*:\s*Lv\.\s*(\d+)", reqs) or 0),
                "renown": int(match(r"Renown\s*:\s*Lv\.\s*(\d+)", reqs) or 0),
                "skills": skills,
                "abilities": {
                    "class": bullets(abil, "Class"),
                    "master": bullets(abil, "Master"),
                },
                **parse_class_page(slug),
            }
    return out


def parse_skill_reqs(cell):
    """'Primary Skill: <Bow Skill> (C)' -> [{skill, rank, kind}]."""
    marks = list(re.finditer(r"(Primary|Secondary) Skill</b>", cell))
    skills = []
    for i, mark in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(cell)
        block = cell[mark.end():end]
        for m in re.finditer(r"alt='([^']*)'[^>]*>\s*\(([A-E])\)", block, re.S):
            skills.append(
                {
                    "skill": m.group(1).replace(" Skill", ""),
                    "rank": m.group(2),
                    "kind": mark.group(1).lower(),
                }
            )
    return skills


def match(pattern, body):
    m = re.search(pattern, body, re.I)
    return m.group(1) if m else None


def bullets(body, label):
    m = re.search(rf"^{label}\s*:\s*$(.*?)(?:^\w+\s*:\s*$|\Z)", body, re.S | re.M)
    if not m:
        return []
    return [ln.lstrip("・･•").strip() for ln in m.group(1).split("\n") if ln.strip().startswith(("・", "･", "•"))]


def parse_class_page(slug):
    """Per-class page: unit type, movement, flat stat bonuses and class growths."""
    path = os.path.join(RAW, "classes", f"{slug}.html")
    if not os.path.exists(path):
        return {}
    doc = read("classes", f"{slug}.html")
    info = {}

    basic = find_table(doc, "Movement")
    if basic:
        body = text(basic).split("\n")
        for key, field in (("Type", "unitType"), ("Movement", "movement")):
            if key in body:
                value = body[body.index(key) + 1] if body.index(key) + 1 < len(body) else ""
                info[field] = int(value) if field == "movement" and value.isdigit() else value

    stats = find_table(doc, "Bonus", "Growth")
    if stats:
        bonuses, growths = {}, {}
        for row in rows(stats)[1:]:
            cs = [c[0].strip() for c in cells(row)]
            if len(cs) < 3 or cs[0] not in STATS:
                continue
            bonuses[cs[0]] = int(cs[1] or 0)
            growths[cs[0]] = int(cs[2] or 0)
        if growths:
            info["bonuses"] = bonuses
            info["growths"] = growths

    exp = find_table(doc, "Skill EXP Bonus")
    if exp:
        body = [ln for ln in text(exp).split("\n") if ln and ln != "Skill EXP Bonus"]
        info["skillExp"] = body[0] if body else ""
    return info


# ─── paralogues: per-route windows, rewards, who they gate ───────────────────
def parse_paralogues():
    doc = read("paralogues.html")
    # Each "<Owner>'s Paralogue: <Title>" heading is followed by that paralogue's table.
    heads = list(re.finditer(r"<h3[^>]*>(.*?)</h3>", doc, re.S))
    out = {}
    for i, head in enumerate(heads):
        title = text(head.group(1))
        m = re.match(r"(.+?)'s Paralogue:\s*(.+)", title)
        if not m:
            continue
        end = heads[i + 1].start() if i + 1 < len(heads) else len(doc)
        block = doc[head.end():end]
        table = find_table(block, "Rewards")
        if not table:
            continue

        routes = {}
        for row in rows(table):
            rm = re.search(r"(\w[\w ]*)'s Path</a>\s*<b[^>]*>([^<]*)</b>", row)
            if not rm:
                continue
            cs = cells(row)
            routes[slugify(rm.group(1))] = {
                "chapter": rm.group(2).strip(),
                "window": cs[-1][0].replace("\n", ", ") if len(cs) > 1 else "",
            }

        # The row after the "Rewards" header holds the reward list.
        reward_cells = cells(rows(table)[1]) if len(rows(table)) > 1 else []
        rewards = [
            ln.lstrip("・･•").strip()
            for ln in (reward_cells[0][0].split("\n") if reward_cells else [])
            if ln.strip()
        ]
        gates = re.search(r"Recruitment Req\. For(.*)", text(table), re.S)
        recruits = []
        if gates:
            recruits = [
                n.strip().lstrip(":").strip()
                for n in gates.group(1).split("\n")
                if n.strip().lstrip(":").strip()
            ]

        out[slugify(m.group(1))] = {
            "owner": m.group(1),
            "title": m.group(2).strip(),
            "rewards": rewards,
            "routes": {r: routes.get(r) for r in ROUTES},
            "recruits": recruits,
        }
    return out


# ─── assemble ────────────────────────────────────────────────────────────────
def main():
    recruitment = parse_recruitment()
    roster = parse_roster()
    best = parse_best_classes()

    characters = {}
    for slug in sorted(set(recruitment) | set(roster)):
        rec = recruitment.get(slug, {})
        base = roster.get(slug, {})
        page = parse_character_page(slug)
        extra = best.get(slug, {})
        routes = rec.get("routes") or {r: None for r in ROUTES}
        if slug in ROUTES and not any(routes.values()):
            routes[slug] = {
                "chapter": "Prologue: Descent Chapter 1",
                "support": 0,
                "renown": 0,
                "negotiation": "",
                "extra": ["Route lord - leads this path"],
            }
        characters[slug] = {
            "name": base.get("name") or rec.get("name") or slug.title(),
            "portrait": base.get("portrait", ""),
            "faction": page.get("faction", ""),
            "likes": base.get("likes", []),
            "interests": base.get("interests", []),
            "growths": page.get("growths", {}),
            "ability": page.get("ability", {}),
            "personalSkill": extra.get("personalSkill", ""),
            "proficiencies": extra.get("proficiencies", []),
            "classPath": extra.get("classPath", []),
            "routes": routes,
            "earliest": min(
                (chapter_sort_key(r) for r in routes.values() if r), default=(9, 99)
            ),
        }

    classes = parse_classes()
    paralogues = parse_paralogues()
    write("characters.js", characters)
    write("classes.js", classes)
    write("paralogues.js", paralogues)
    no_growths = [c["name"] for c in classes.values() if not c.get("growths")]
    if no_growths:
        print(f"no class growth data yet for: {', '.join(sorted(no_growths))}")
    missing = [s for s, c in characters.items() if not c["growths"]]
    print(f"{len(characters)} characters, {len(classes)} classes, {len(paralogues)} paralogues")
    if missing:
        print(f"no growth data yet for: {', '.join(missing)}")


def write(filename, data):
    dst = os.path.join(OUT, filename)
    with open(dst, "w", encoding="utf-8") as f:
        f.write("// Generated by scripts/transform.py — do not edit by hand.\n")
        f.write("export default " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n")
    print(f"wrote {dst}")


if __name__ == "__main__":
    main()
