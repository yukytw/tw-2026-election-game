"""Pull each candidate photo's Commons wikitext and draft data/photo-review.json.

Rules (conservative):
  * GWOIA / LYWOIA (政府網站資料開放宣告) from the agency's own site → approve, license = 政府資料開放授權條款第1版
  * CC0 / CC BY / CC BY-SA by an identifiable photographer → approve
  * Anything sourced from 選舉公報 (bulletin.cec.gov.tw): the candidate supplied that photo, so the
    election commission's open-data notice may not cover it → reject
  * Filenames that look like re-uploaded news/social photos → reject
The draft is for a human to confirm; flip "approve" by hand after checking the Commons page.
"""
import json, re, time, urllib.parse, urllib.request

UA = "tw-2026-election-game/0.1 (photo review)"
GOV_LICENSE = ("政府資料開放授權條款第1版", "https://data.gov.tw/license")
SUSPICIOUS_FILE = re.compile(r"^File:S \d+|^File:\d{6,}|FB_IMG|IMG_\d+", re.I)

def wikitext(title):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(dict(
        action="query", titles=title, prop="revisions", rvprop="content", rvslots="main",
        format="json", formatversion=2))
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                p = json.load(r)["query"]["pages"][0]
                return p["revisions"][0]["slots"]["main"]["content"]
        except Exception:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(title)

lookup = json.load(open("data/photo-lookup.json", encoding="utf-8"))
try:
    review = json.load(open("data/photo-review.json", encoding="utf-8"))
except FileNotFoundError:
    review = {}

for r in lookup:
    if r["status"] != "free" or r["name"] in review:
        continue
    text = wikitext(r["file"])
    src = (re.search(r"\|\s*source\s*=\s*(\S+)", text, re.I) or [None, ""])[1]
    gov = re.search(r"\{\{\s*(GWOIA|LYWOIA|LY-GWOIA|OGDL|Taiwan.?Open)", text, re.I)
    d = {"file": r["file"], "source": src}
    if "bulletin.cec.gov.tw" in src:
        d.update(approve=False, note="選舉公報照片，由候選人提供，開放宣告未必涵蓋")
    elif SUSPICIOUS_FILE.search(r["file"]):
        d.update(approve=False, note="檔名像轉貼新聞／社群照片，來源存疑")
    elif gov:
        d.update(approve=True, license=GOV_LICENSE[0], licenseUrl=GOV_LICENSE[1],
                 note=f"{gov[1]}：{r.get('artist')}官網肖像")
    elif re.match(r"CC0|CC BY", r["license"]):
        d.update(approve=True, note=f"{r['license']}，作者 {r.get('artist')}")
    else:
        d.update(approve=False, note=f"授權不明：{r['license']}")
    review[r["name"]] = d
    print("✔" if d["approve"] else "✘", r["name"], "|", d["note"], "|", src[:70], flush=True)
    time.sleep(2)

json.dump(review, open("data/photo-review.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
