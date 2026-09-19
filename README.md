# Fortune's Weave Army Planner

Plan a separate army for each of the four routes in *Fire Emblem: Fortune's Weave* —
Cai, Dietrich, Theodora and Leda — and see exactly what it takes to recruit each unit
on the route you're actually playing.

Same shape as the [Lumentale team planner](../lumentale-team-planner): vanilla ES
modules, no build step, one generated data file per subject. Open `index.html`
through any static server and it runs.

```bash
python3 -m http.server 8766
```

## What it does

**Per-route plans.** Four route tabs, each with its own army, its own recruit
checklist and its own share link. Picks persist in `localStorage`, so the four plans
sit side by side and survive a reload. *Copy army from…* seeds one route from another
so you can compare the same team across paths.

Each route's lord is locked into slot 0 of that route — Cai on Cai's path, Dietrich on
Dietrich's — with no remove button, no recruitment checkbox and no place in the recruited
tally, since there is nothing to recruit. Their build path stays fully editable. Clearing
a route leaves them standing, and copying an army between routes drops the source route's
lord rather than carrying them across.

**Recruitment requirements, in play order.** Every member's row shows the chapter they
become recruitable, the Support level, the Renown level, the negotiation difficulty and
any one-off condition ("Give 3 Iron Swords to Loretta", "Clear Cai's Paralogue"). The
summary chips roll that up: how many you've recruited, the peak Renown the plan demands,
how many negotiations and paralogue gates are involved, and — in red — anyone you've
picked who *can't* be recruited on this route at all.

**Required paralogues.** Recruit conditions that point at a paralogue get expanded into
the paralogue's own chapter and in-game date window *on the current route*, who it
unlocks, and the 150 Renown it pays out. A paralogue that doesn't appear on your route
is flagged red — that's the trap this panel exists to catch.

**Gifts.** Each character's Likes and Interests drive support gain, so the army's gift
cheat sheet is right under the plan, and every plan row carries the same thing as a
tooltip.

**Build paths.** Every army slot carries a four-tier build — Beginner, Specialty,
Advanced, Master — seeded with Game8's recommended progression and changeable at each
tier. The slot shows what the build ends as (class, unit type, movement) and the three
stats its class growth moves most; the plan row spells the progression out with its level
gates, and the plan's peak-Renown figure accounts for every class license in every build,
not just the recruitment requirements. If any class in the build gates on a skill rank
the character has no proficiency in, the slot says which skill and why it matters —
they can still certify, but skill EXP in a non-proficiency comes slowly.

**Stats.** The detail panel (the `i` on any roster card) shows growth rates, the personal
ability, skill proficiencies, the recommended class progression, and a four-route
comparison of that character's recruitment requirements. For anyone already in the
current army it also breaks growths into base, the final class's modifier, and the
total.

**Class browser.** The right panel toggles between *Characters* and *Classes*. The class
list covers all 43, ordered by license tier and filterable by tier, unit type and required
skill, with an *In this army's builds* filter and an accent stripe on anything the current
army is already building into. Opening one shows its license and level gates, Renown
requirement, the Part it unlocks in, primary/secondary skill ranks, flat stat bonuses
beside class growth modifiers, class and mastery abilities, skill EXP bonuses, who in the
current army is building into it, and every character whose proficiencies already cover
its skill requirements. The same panel opens from the `i` beside each tier dropdown in an
army slot and from the steps of a character's recommended class path.

**Balance checks.** Proficiency coverage counts how many of your army are natural
Sword/Bow/White Magic/Flier/etc. users — an easy way to notice you have no healer — and
the growth table averages the army's growth rates per stat.

## Data pipeline

Data is scraped from the [Game8 guides](https://game8.co/games/Fire-Emblem-Fortunes-Weave).

```bash
python3 scripts/fetch.py        # hub pages + one page per character -> raw/
python3 scripts/fetch.py --force  # ignore the cache and refetch
python3 scripts/transform.py    # raw/ -> static/js/*.js
```

| File | Contents |
|---|---|
| `static/js/characters.js` | 53 characters: portrait, faction, likes, interests, growth rates, personal ability, proficiencies, recommended class path, and per-route recruitment requirements |
| `static/js/classes.js` | 43 classes: license tier, unlock part, ideal level, Renown level, skill-rank requirements, class and mastery abilities, unit type, movement, flat stat bonuses and class growth modifiers |
| `static/js/paralogues.js` | 9 paralogues: per-route chapter and date window, rewards, and which recruits they gate |

`raw/` is cached HTML and is gitignored; `scripts/transform.py` is pure parsing, so you
can re-run it freely.

## Known data gaps

The game is days old and the guides are still marked work-in-progress, so:

- **Growth rates only, no base stats or level curves.** Switch 2 titles can't be
  datamined, so nobody has published bases yet. When they do, add them in
  `parse_character_page()` and they'll flow straight into the detail panel.
- **13 classes have no growth data yet** (Battlemaster, Bow Adept, Castle Knight, Dancer,
  Druid, Elephant Rider, Orichaldia, Ranger, Sentinel, Shadow Seeker, Valkyrium, War Monk,
  Wiseman) — mostly Master tier, which has no individual Game8 pages yet. They're still
  pickable in a build; the slot just says the growths aren't published.
- **Part I recruitment only.** Characters who join in later Parts (Anatolia, Talimun,
  Bertrand, Orchel, Centurio, Creek, Aswan) aren't in the recruitment table yet and so
  aren't in the roster.
- Individual numbers occasionally change as the guides are corrected — re-run
  `fetch.py --force && transform.py` to pick that up.

Portraits are hotlinked from Game8's CDN. If that ever breaks, cache them locally and
rewrite the `portrait` field in `transform.py`.
