#!/usr/bin/env python3
"""Download the Game8 Fortune's Weave guide pages into raw/.

Guide pages are still being filled in post-launch, so re-run this whenever you
want fresher numbers. Pages are cached by filename; pass --force to refetch.
"""
import os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
BASE = "https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36"

# Hub pages: local name -> Game8 article id
HUBS = {
    "recruitment": 620957,
    "characters": 619779,
    "gifts": 623690,
    "classes": 620256,
    "best-classes": 624119,
    "renown": 620477,
    "paralogues": 624240,
}

FORCE = "--force" in sys.argv


def get(url, dest):
    if os.path.exists(dest) and not FORCE:
        return open(dest, encoding="utf-8").read()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    with open(dest, "w", encoding="utf-8") as f:
        f.write(body)
    time.sleep(0.4)
    print(f"  fetched {os.path.basename(dest)} ({len(body)//1024}KB)")
    return body


os.makedirs(os.path.join(RAW, "chars"), exist_ok=True)

print("Hub pages:")
pages = {}
for name, aid in HUBS.items():
    pages[name] = get(f"{BASE}/{aid}", os.path.join(RAW, f"{name}.html"))

# Each row of the character list links to that character's own page, which is
# where the growth rates live.
table = re.findall(r"<table.*?</table>", pages["characters"], re.S)[2]
found = {}
for aid, name in re.findall(r"href=%s/(\d+)><img[^>]*alt='([^']*)'" % re.escape(BASE), table):
    found.setdefault(name, aid)

print(f"Character pages ({len(found)}):")
for name, aid in sorted(found.items()):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    get(f"{BASE}/{aid}", os.path.join(RAW, "chars", f"{slug}.html"))

# Class rows link to a per-class page carrying stat bonuses and class growth rates.
os.makedirs(os.path.join(RAW, "classes"), exist_ok=True)
class_links = {}
for table in re.findall(r"<table.*?</table>", pages["classes"], re.S):
    if "Requirements" not in table:
        continue
    for aid, name in re.findall(
        r"href=%s/(\d+)><img[^>]*alt='([^']*)'" % re.escape(BASE), table
    ):
        class_links.setdefault(name, aid)

print(f"Class pages ({len(class_links)}):")
for name, aid in sorted(class_links.items()):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    get(f"{BASE}/{aid}", os.path.join(RAW, "classes", f"{slug}.html"))

print("Done. Now run scripts/transform.py")
