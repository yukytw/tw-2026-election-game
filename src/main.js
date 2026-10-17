import { COUNTY_PATHS } from "./data/counties.js";
import { CANDIDATES } from "./data/candidates.js";

const GAME_MS = 60_000;
// Every COMBO_STEP correct answers in a row buys COMBO_BONUS_MS more time.
const COMBO_STEP = 5;
const COMBO_BONUS_MS = 3_000;
const REVEAL_OK_MS = 450;
const REVEAL_BAD_MS = 1_000;

// Distractors get harder as the player warms up: more of them come from the same region.
const REGIONS = {
  北: ["臺北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "宜蘭縣"],
  中: ["苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣"],
  南: ["嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣"],
  東: ["花蓮縣", "臺東縣"],
  離島: ["澎湖縣", "金門縣", "連江縣"],
};
const regionOf = (c) => Object.keys(REGIONS).find((r) => REGIONS[r].includes(c));
const ALL_COUNTIES = Object.values(REGIONS).flat();

const RANKS = [
  [0, "初次見面"],
  [3, "新聞路過的路人"],
  [6, "選情觀察家"],
  [10, "政論節目常客"],
  [15, "選舉宅神"],
  [20, "人肉中選會"],
];

const SHARE_LINES = [
  [0, () => "一題都沒對，也太難了吧"],
  [1, (n) => `只答對 ${n} 題，也太難了吧`],
  [6, (n) => `答對 ${n} 題，有人要挑戰嗎`],
  [11, (n) => `答對 ${n} 題，有人贏得了嗎`],
];

const $ = (id) => document.getElementById(id);
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sample = (arr, n) => shuffle([...arr]).slice(0, n);

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let state = null;

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${id}`));
  document.body.dataset.screen = id;
  window.scrollTo(0, 0);
}

function countySvg(county) {
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${COUNTY_PATHS[county]}"/></svg>`;
}

function pickOptions(answer, correct) {
  const sameRegion = REGIONS[regionOf(answer)].filter((c) => c !== answer);
  const nHard = Math.min(sameRegion.length, correct >= 10 ? 2 : correct >= 5 ? 1 : 0);
  const hard = sample(sameRegion, nHard);
  const rest = ALL_COUNTIES.filter((c) => c !== answer && !hard.includes(c));
  return shuffle([answer, ...hard, ...sample(rest, 3 - hard.length)]);
}

function preload(c) {
  if (c) new Image().src = c.photo;
}

// Every BLOCK questions hold a fixed number of less-known faces ("minor" tier), so each run
// has the same difficulty mix instead of depending on who happens to be drawn. A face does
// not repeat until its whole pool has been used.
const BLOCK = 7;
const MINOR_PER_BLOCK = 2;

export function makeDraw() {
  const pools = {
    main: { all: CANDIDATES.filter((c) => c.tier !== "minor"), bag: [] },
    minor: { all: CANDIDATES.filter((c) => c.tier === "minor"), bag: [] },
  };
  let last = null;
  const take = (kind) => {
    const pool = pools[kind].all.length ? pools[kind] : pools[kind === "main" ? "minor" : "main"];
    if (!pool.bag.length) {
      pool.bag = shuffle([...pool.all]);
      // Don't let a refill put the face we just showed straight back on top.
      const top = pool.bag.length - 1;
      if (top > 0 && pool.bag[top] === last) [pool.bag[0], pool.bag[top]] = [pool.bag[top], pool.bag[0]];
    }
    last = pool.bag.pop();
    return last;
  };
  let queue = [];
  return () => {
    if (!queue.length) {
      const kinds = shuffle([...Array(BLOCK - MINOR_PER_BLOCK).fill("main"), ...Array(MINOR_PER_BLOCK).fill("minor")]);
      queue = kinds.map(take);
    }
    return queue.shift();
  };
}

function start() {
  const draw = makeDraw();
  state = {
    draw,
    cur: null,
    next: draw(),
    correct: 0,
    total: 0,
    combo: 0,
    maxCombo: 0,
    missed: [],
    endAt: performance.now() + GAME_MS,
    locked: false,
    over: false,
  };
  $("hud-score").textContent = "0";
  $("hud-combo").textContent = "";
  show("play");
  nextQuestion();
  requestAnimationFrame(tick);
}

function current() {
  return state.cur;
}

function nextQuestion() {
  state.cur = state.next;
  state.next = state.draw();
  const c = state.cur;
  preload(state.next);

  // Swap the caption while hidden with transitions off, so the fade that plays
  // on the *next* reveal never flashes this question's answer first.
  const portrait = document.querySelector(".portrait");
  portrait.classList.add("notransition");
  portrait.classList.remove("revealed");
  $("q-photo").src = c.photo;
  $("q-reveal").innerHTML = `${c.name}<small>${c.party}・${c.county}</small>`;
  void portrait.offsetWidth; // flush the instant hide before re-enabling the transition
  portrait.classList.remove("notransition");

  const box = $("choices");
  box.classList.remove("revealed");
  box.innerHTML = "";
  for (const [i, county] of pickOptions(c.county, state.correct).entries()) {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.dataset.county = county;
    // Naming the county here would give the answer away, so options are only numbered.
    btn.setAttribute("aria-label", `選項 ${i + 1}`);
    btn.innerHTML = `${countySvg(county)}<span class="name">${county}</span>`;
    btn.addEventListener("click", () => answer(btn));
    box.appendChild(btn);
  }
  state.locked = false;
}

function answer(btn) {
  if (state.locked || state.over) return;
  state.locked = true;
  const c = current();
  const ok = btn.dataset.county === c.county;
  state.total++;

  const box = $("choices");
  box.classList.add("revealed");
  box.querySelector(`[data-county="${c.county}"]`).classList.add("correct");
  document.querySelector(".portrait").classList.add("revealed");

  if (ok) {
    state.correct++;
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    $("hud-score").textContent = state.correct;
    const comboEl = $("hud-combo");
    comboEl.textContent = state.combo >= 2 ? `${state.combo} 連擊` : "";
    comboEl.classList.remove("pop");
    void comboEl.offsetWidth;
    comboEl.classList.add("pop");
    if (state.combo % COMBO_STEP === 0) {
      state.endAt += COMBO_BONUS_MS;
      const bonus = $("bonus");
      bonus.classList.remove("show");
      void bonus.offsetWidth;
      bonus.classList.add("show");
    }
    navigator.vibrate?.(15);
  } else {
    btn.classList.add("wrong");
    state.combo = 0;
    $("hud-combo").textContent = "";
    state.missed.push(c);
    navigator.vibrate?.([30, 40, 30]);
  }

  setTimeout(() => {
    if (state.over) return;
    nextQuestion();
  }, ok ? REVEAL_OK_MS : REVEAL_BAD_MS);
}

function tick(now) {
  if (!state || state.over) return;
  const left = Math.max(0, state.endAt - now);
  $("timer-bar").style.transform = `scaleX(${Math.min(1, left / GAME_MS)})`;
  $("hud-time").textContent = Math.ceil(left / 1000);
  document.querySelector(".timer").classList.toggle("low", left < 10_000);
  if (left <= 0) return finish();
  requestAnimationFrame(tick);
}

function rankFor(score) {
  return RANKS.filter(([min]) => score >= min).at(-1)[1];
}

function shareText() {
  return SHARE_LINES.filter(([min]) => state.correct >= min).at(-1)[1](state.correct);
}

function shareUrl() {
  return location.origin + location.pathname;
}

function finish() {
  state.over = true;
  const best = Number(storage.get("best") || 0);
  const isBest = state.correct > best;
  if (isBest) storage.set("best", String(state.correct));

  $("r-score").textContent = state.correct;
  $("r-rank").textContent = `「${rankFor(state.correct)}」`;
  $("r-correct").textContent = state.correct;
  $("r-total").textContent = state.total;
  $("r-combo").textContent = state.maxCombo;
  $("r-best").hidden = !isBest || state.correct === 0;

  const missed = [...new Map(state.missed.map((c) => [c.name, c])).values()];
  $("missed-title").hidden = missed.length === 0;
  $("missed").innerHTML = missed
    .map((c) => `<li><img src="${c.photo}" alt="" loading="lazy">${c.name}<small>${c.county}</small></li>`)
    .join("");

  const text = shareText();
  const url = shareUrl();
  const enc = encodeURIComponent;
  // line.me/R/share opens the app directly on a phone; the lineit plugin demands a web login first.
  $("share-line").href = `https://line.me/R/share?text=${enc(`${text} ${url}`)}`;

  show("result");
  prepareImage();
}

// ---------- share image ----------

function drawResultImage() {
  const W = 1080, H = 1350;
  // +55 keeps the block optically centred now that nothing is drawn below the stats line.
  const dy = 55;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d");
  const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;

  g.fillStyle = "#14213d";
  g.fillRect(0, 0, W, H);

  // A faint scatter of county outlines as backdrop.
  const counties = sample(ALL_COUNTIES, 9);
  g.fillStyle = "rgba(255,255,255,0.06)";
  counties.forEach((c, i) => {
    g.save();
    g.translate((i % 3) * 360 + 30, Math.floor(i / 3) * 450 + 40);
    g.scale(3, 3);
    g.fill(new Path2D(COUNTY_PATHS[c]));
    g.restore();
  });

  g.translate(0, dy);
  g.textAlign = "center";
  g.fillStyle = "#ff6b35";
  g.font = font(800, 40);
  g.fillText("2026 九合一 · 縣市長篇", W / 2, 170);
  g.fillStyle = "#fff";
  g.font = font(900, 120);
  g.fillText("這誰？選哪？", W / 2, 320);

  g.font = font(700, 44);
  g.fillStyle = "rgba(255,255,255,.75)";
  g.fillText("60 秒挑戰 · 我答對了", W / 2, 500);
  g.fillStyle = "#fff";
  g.font = font(900, 300);
  g.fillText(String(state.correct), W / 2, 790);
  g.font = font(800, 56);
  g.fillText("題", W / 2, 880);

  g.fillStyle = "#ff6b35";
  g.font = font(900, 72);
  g.fillText(`「${rankFor(state.correct)}」`, W / 2, 1030);

  g.fillStyle = "rgba(255,255,255,.75)";
  g.font = font(600, 36);
  g.fillText(`最高 ${state.maxCombo} 連擊 · 共答 ${state.total} 題`, W / 2, 1110);

  return new Promise((r) => cv.toBlob(r, "image/png"));
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2200);
}

// Rendered as soon as the result screen shows: Safari drops the user-gesture permission if we
// start drawing only after the tap and then call navigator.share.
function prepareImage() {
  state.blob = null;
  drawResultImage().then((blob) => { state.blob = blob; });
}

const imageBlob = async () => state.blob ?? drawResultImage();

function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  // Firefox ignores click() on an element that is not in the document; Chrome and Safari do not.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Sharing a file needs the system share sheet, which browsers only expose on HTTPS (or localhost).
// Everything is inside the try: an in-app browser without File or canShare would otherwise throw
// past the caller and leave the button looking dead.
async function shareFile(blob, name, extra = {}) {
  try {
    const file = new File([blob], name, { type: "image/png" });
    if (!navigator.canShare?.({ files: [file] })) return false;
    await navigator.share({ files: [file], ...extra });
  } catch (e) {
    return e?.name === "AbortError"; // cancelling counts as handled; anything else falls through
  }
  return true;
}

// navigator.clipboard is missing in most in-app browsers, so fall back to the old textarea trick.
async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function share() {
  const text = shareText();
  const url = shareUrl();
  const payload = `${text} ${url}`;
  let blob = null;
  try {
    blob = await imageBlob();
  } catch {}

  if (blob && await shareFile(blob, "result.png", { text: payload })) return;
  try {
    if (navigator.share) {
      await navigator.share({ text, url });
      return;
    }
  } catch (e) {
    if (e?.name === "AbortError") return;
  }
  if (await copyText(payload)) return toast("已複製分享文字，貼到任何地方吧！");
  if (blob) {
    saveBlob(blob, `這誰選哪-${state.correct}題.png`);
    return toast("已儲存成績圖，可以自己貼到社群");
  }
  toast("請用選單在外部瀏覽器開啟，再分享一次");
}

async function downloadImage() {
  saveBlob(await imageBlob(), `這誰選哪-${state.correct}題.png`);
}

// ---------- credits ----------

function renderCredits() {
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  $("credits").innerHTML = [...CANDIDATES]
    .sort((a, b) => ALL_COUNTIES.indexOf(a.county) - ALL_COUNTIES.indexOf(b.county))
    .map((c) => {
      const lic = c.credit.licenseUrl
        ? `<a href="${esc(c.credit.licenseUrl)}" target="_blank" rel="noopener">${esc(c.credit.license)}</a>`
        : esc(c.credit.license);
      return `<li>${esc(c.name)}（${esc(c.county)}）：<a href="${esc(c.credit.source)}" target="_blank" rel="noopener">照片</a> by ${esc(c.credit.author || "未具名")}，${lic}，經裁切縮放</li>`;
    })
    .join("");
}

// ---------- wiring ----------

let previous = "start";
document.querySelectorAll("[data-open=credits]").forEach((b) =>
  b.addEventListener("click", () => {
    previous = document.querySelector(".screen.active").id.replace("screen-", "");
    show("credits");
  })
);
document.querySelector("[data-back]").addEventListener("click", () => show(previous));
$("btn-start").addEventListener("click", start);
$("btn-again").addEventListener("click", start);
$("btn-share").addEventListener("click", share);
$("share-img").addEventListener("click", downloadImage);

const best = Number(storage.get("best") || 0);
if (best > 0) {
  $("best-score").hidden = false;
  $("best-score").textContent = `你的最佳紀錄：${best} 題`;
}
renderCredits();
preload(CANDIDATES[0]);
