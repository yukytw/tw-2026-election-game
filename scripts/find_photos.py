"""Look up each candidate's Wikipedia lead image and its Commons license.

Output: data/photo-lookup.json — for manual review before anything is downloaded.
"""
import json, re, sys, time, urllib.error, urllib.parse, urllib.request

UA = "tw-2026-election-game/0.1 (photo license lookup)"
FREE = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? [\d.]+( tw| TW)?|OGDL|政府資料開放授權條款|Attribution)", re.I)

def get(api, **params):
    params.update(format="json", formatversion=2)
    url = api + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("rate limited: " + url)

def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()

# Wikipedia titles that differ from the registered name or need a specific disambiguator.
TITLE_OVERRIDES = {
    "黃世杰": ["黃世傑 (政治人物)"],
    "郭璽": ["郭璽 (政治人物)"],
    "吳宗憲": ["吳宗憲 (1971年)"],
    "許淑華": ["許淑華 (1975年)"],
    "劉建國": ["劉建國 (台灣政治人物)"],
    "何志勇": ["何志勇 (1980年)"],
    "張靜": ["張靜 (台灣律師)"],
    "王忠銘": ["王忠銘 (中華民國)"],
    "溫世政": ["温世政"],
    "陳振中": ["陳振中 (澎湖)"],
}

# Re-run selected names only: find_photos.py 吳宗憲 許淑華 ...
ONLY = set(sys.argv[1:])
previous = {}
if ONLY:
    previous = {r["name"]: r for r in json.load(open("data/photo-lookup.json", encoding="utf-8"))}

out = []
for line in open("data/candidates.tsv", encoding="utf-8"):
    county, name, party = line.rstrip("\n").split("\t")
    if ONLY and name not in ONLY:
        out.append(previous[name])
        continue
    rec = {"county": county, "name": name, "party": party}
    page = None
    for title in TITLE_OVERRIDES.get(name, [name + " (政治人物)", name]):
        q = get("https://zh.wikipedia.org/w/api.php", action="query", titles=title, redirects=1,
                prop="pageimages|extracts|pageprops", piprop="name", exintro=1, explaintext=1, exchars=160,
                variant="zh-tw")
        page = q["query"]["pages"][0]
        if not page.get("missing") and "disambiguation" not in page.get("pageprops", {}):
            break
    if page.get("missing"):
        rec["status"] = "no-wiki"
    else:
        rec["wiki"] = page["title"]
        rec["extract"] = page.get("extract", "")
        rec["disambig"] = "disambiguation" in page.get("pageprops", {})
        img = page.get("pageimage")
        if not img:
            rec["status"] = "no-image"
        else:
            c = get("https://commons.wikimedia.org/w/api.php", action="query", titles="File:" + img,
                    prop="imageinfo", iiprop="url|extmetadata|size", iiurlwidth=480)
            p = c["query"]["pages"][0]
            if p.get("missing") or "imageinfo" not in p:
                rec["status"] = "not-on-commons"  # local zh.wiki file, likely fair use
                rec["file"] = img
            else:
                ii = p["imageinfo"][0]; m = ii.get("extmetadata", {})
                v = lambda k: strip_html(m.get(k, {}).get("value", ""))
                rec.update(file=p["title"], page=ii["descriptionurl"], thumb=ii.get("thumburl"),
                           license=v("LicenseShortName"), licenseUrl=v("LicenseUrl"), usage=v("UsageTerms"),
                           artist=v("Artist"), credit=v("Credit"), restrictions=v("Restrictions"))
                rec["status"] = "free" if FREE.match(rec["license"]) else "check-license"
    out.append(rec)
    print(f'{rec["status"]:15} {county} {name} | {rec.get("license","")} {rec.get("usage","")[:30]} | {rec.get("extract","")[:50]!r}', flush=True)
    time.sleep(1.5)

json.dump(out, open("data/photo-lookup.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
