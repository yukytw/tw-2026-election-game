"""Download approved Commons photos, crop a square around the face, and emit src/data/candidates.js.

Input:  data/photo-lookup.json   (from find_photos.py)
        data/photo-review.json   (manual decisions: {"name": {"approve": bool, ...}})
Only entries explicitly approved in photo-review.json are shipped.

Needs OpenCV for face detection:  python3 -m venv .venv && .venv/bin/pip install "opencv-python-headless<5"
Run with:                          .venv/bin/python scripts/build_photos.py
"""
import json, os, re, sys, time, urllib.request

import cv2
import numpy as np

UA = "tw-2026-election-game/0.1 (photo build)"
SIZE = 360
CACHE = "data/.photo-cache"
MANUAL = "data/manual-crops"  # <姓名>.jpg here overrides the automatic crop

lookup = json.load(open("data/photo-lookup.json", encoding="utf-8"))
review = json.load(open("data/photo-review.json", encoding="utf-8"))
os.makedirs("img", exist_ok=True)
os.makedirs(CACHE, exist_ok=True)
detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def fetch(url, path):
    if os.path.exists(path):
        return
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp, open(path, "wb") as f:
        f.write(resp.read())
    time.sleep(1)


def face_crop(img, name, manual=None, pad=False):
    """Square crop framing the head: hair on top, a bit of shoulders below.

    manual = [centre_x, centre_y, side] as fractions of the image width/height/width,
    for photos the detector gets wrong (set "crop" in photo-review.json).
    pad    = with manual, let the box extend past the photo and fill the overhang with the
    backdrop colour — for tight ID-style shots on a plain background (set "pad": true).
    """
    H, W = img.shape[:2]
    if manual:
        cx, cy = manual[0] * W, manual[1] * H
        if pad:
            # The box may stick out of the photo; fill the overhang with the backdrop colour.
            side = int(manual[2] * W)
            left, top = int(cx - side / 2), int(cy - side / 2)
            bg = [int(v) for v in np.median(img[:4].reshape(-1, 3), axis=0)]
            t, l = max(0, -top), max(0, -left)
            b, r = max(0, top + side - H), max(0, left + side - W)
            img = cv2.copyMakeBorder(img, t, b, l, r, cv2.BORDER_CONSTANT, value=bg)
            return img[top + t:top + t + side, left + l:left + l + side]
        side = min(int(manual[2] * W), W, H)
        left = int(min(max(cx - side / 2, 0), W - side))
        top = int(min(max(cy - side / 2, 0), H - side))
        return img[top:top + side, left:left + side]
    gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    faces = detector.detectMultiScale(gray, 1.1, 5, minSize=(W // 8, W // 8))
    # In a portrait the face is in the upper part; hits lower down are shirts, logos, hands.
    faces = [f for f in faces if f[1] + f[3] / 2 < H * 0.6]
    if len(faces):
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        side = min(int(w * 2.2), W, H)
        cx = x + w / 2
        top = y - 0.7 * w * side / (w * 2.2)  # keep hair headroom proportional if we had to shrink
    else:
        print(f"  ! no face found for {name}, using upper-centre crop", file=sys.stderr)
        side = min(W, H)
        cx, top = W / 2, (H - side) * 0.2
    left = int(min(max(cx - side / 2, 0), W - side))
    top = int(min(max(top, 0), H - side))
    return img[top:top + side, left:left + side]


county = lambda c: re.sub(r"^台", "臺", c)
out = []
for i, r in enumerate(lookup):
    decision = review.get(r["name"], {})
    if not decision.get("approve"):
        continue
    slug = f"c{i:02d}"
    raw = f"{CACHE}/{slug}.src"
    dst = f"img/{slug}.webp"
    manual = next((f"{MANUAL}/{r['name']}.{ext}" for ext in ("jpg", "jpeg", "png", "webp")
                   if os.path.exists(f"{MANUAL}/{r['name']}.{ext}")), None)
    if manual:
        # Hand-cropped by a person: trust it, only centre-square it in case it is not exactly square.
        img = cv2.imread(manual)
        H, W = img.shape[:2]
        side = min(W, H)
        crop = img[(H - side) // 2:(H - side) // 2 + side, (W - side) // 2:(W - side) // 2 + side]
        print("  manual crop:", manual)
    else:
        src = decision.get("sourceFile")  # a full-resolution original checked into data/
        if not src:
            fetch(r["thumb"], raw)
            src = raw
        crop = face_crop(cv2.imread(src), r["name"], decision.get("crop"), decision.get("pad"))
    # INTER_AREA is for shrinking; small source photos need a proper upscaler.
    interp = cv2.INTER_AREA if crop.shape[0] >= SIZE else cv2.INTER_LANCZOS4
    crop = cv2.resize(crop, (SIZE, SIZE), interpolation=interp)
    cv2.imwrite(dst, crop, [cv2.IMWRITE_WEBP_QUALITY, 78])
    out.append({
        "name": r["name"], "county": county(r["county"]), "party": r["party"], "photo": dst,
        # "main" = current/former legislator or county/city head; "minor" = everyone else (see README)
        "tier": decision.get("tier", "main"),
        "credit": {"author": decision.get("author") or r.get("artist", "").strip("​ "),
                   "license": decision.get("license") or r["license"],
                   "licenseUrl": decision.get("licenseUrl") or r.get("licenseUrl", ""),
                   "source": r["page"]},
    })

with open("src/data/candidates.js", "w", encoding="utf-8") as f:
    f.write("// Generated by scripts/build_photos.py — do not edit.\n")
    f.write(f"export const CANDIDATES = {json.dumps(out, ensure_ascii=False, indent=1)};\n")
print(len(out), "candidates")
