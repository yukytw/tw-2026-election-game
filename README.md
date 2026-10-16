# 這誰？選哪？— 2026 縣市長候選人臉與地圖配對挑戰

手機版網頁小遊戲：60 秒內看照片認出 2026 縣市長候選人，從 4 個縣市輪廓中選出他參選的縣市。每 5 連擊加 3 秒，結束後有結算頁與分享（Web Share API 分享成績圖，或 LINE／Facebook／Threads 連結與 Instagram 限時動態）。

純靜態網站，不需要 build，直接把整個資料夾部署到 GitHub Pages、Cloudflare Pages 或 Netlify 即可。

```sh
python3 -m http.server 8000   # 本機預覽 http://localhost:8000
```

## 資料流程

| 步驟 | 指令 | 產出 |
|---|---|---|
| 縣市輪廓 | `node scripts/build_maps.mjs` | `src/data/counties.js` |
| 查照片與授權 | `python3 -I scripts/find_photos.py` | `data/photo-lookup.json` |
| 人工審核 | 編輯 `data/photo-review.json` | — |
| 下載、以臉為中心裁切、產生題庫 | `.venv/bin/python -I scripts/build_photos.py`（需先 `python3 -m venv .venv && .venv/bin/pip install "opencv-python-headless<5"`） | `img/*.webp`、`src/data/candidates.js` |

不在 Commons 的照片：在 `photo-lookup.json` 手動填 `thumb`／`page`／`license`，在 `photo-review.json` 核准。

`data/candidates.tsv` 是登記參選人名單（2026/9/4 登記截止）。**11/17 中選會公告正式候選人名單後要再核對一次**，有人退選或資格不符就從 TSV 拿掉重跑。

## 照片授權原則

- 只用 Wikimedia Commons，或政府機關官網依其資料開放宣告提供的官方肖像（例：黃世杰取自立法院官網，依[立法院網站資料開放宣告](https://www.ly.gov.tw/Pages/List.aspx?nodeid=10772)），且以 **公眾領域、CC0、CC BY、CC BY-SA、政府資料開放授權條款** 釋出的照片。不用新聞照、競選官網照、臉書照、中選會選舉公報照（著作權歸屬不明確）。
- `find_photos.py` 只是初篩；每張照片都要在 `photo-review.json` 手動 `approve: true` 才會上線。審核時打開 Commons 頁面確認：授權確實可商用／可改作、作者標示、照片確實是本人且不是過舊的照片。
- CC BY / BY-SA 要求標示作者、授權與修改情形 → 遊戲內「照片授權與資料來源」頁自動列出每張照片的作者、授權連結與「經裁切縮放」。
- 肖像權：候選人屬公眾人物，此為非營利、中立的趣味用途，但仍避免任何醜化、配字或加工；所有候選人一律同樣處理，不用政黨色彩。
- 臉部偵測失準的照片，在 `photo-review.json` 加 `"crop": [中心x, 中心y, 邊長]`（皆為圖寬／高的比例）手動指定裁切；背景是純色、臉塞滿畫面的證件照，再加 `"pad": true` 讓裁切框超出原圖，超出部分補背景色（例：柯志恩、張啓楷）。
- 沒有開放授權照片的參選人不收錄（多為小黨與無黨籍）。這會讓題庫偏向主要政黨，在授權頁已註明。

## 中立性

- 不顯示政黨顏色、不排序、不評論；作答後才揭曉姓名、政黨、縣市。
- 頁面標示「與任何政黨、候選人無關」。投票日前後若要調整（例如投票日當天暫停上線），自行決定。

## 出題公平性

- 每位候選人在 `photo-review.json` 有 `tier`：預設 `main`（現任或曾任立委、縣市長），其餘（議員、鄉鎮市長、素人）標 `minor`。
- 抽題以 7 題為一個區塊：5 位 `main` + 2 位 `minor`，區塊內順序隨機，所以每局的難度組成差不多，不會因為運氣好一局都是名人。同一張臉在該組用完前不重複。
- 區塊大小與比例是 `src/main.js` 的 `BLOCK`、`MINOR_PER_BLOCK`，目前依題庫比例（29:12）設定；題庫增減後要一起調整。
- 這是依職務分級，不是實測辨識度；邊界個案（例：李四川為前副市長、童子瑋為基隆市議長，都標 `minor`；黃世杰、周倪安為曾任立委，標 `main`）可直接改 `tier`。

## 分享的限制

- 分享只有三顆按鈕：「分享成績」（系統分享選單，唯一能帶成績圖的）、LINE、「下載成績圖」。
- **附圖只有「分享成績」能做到**，靠的是手機的系統分享選單（Web Share API）。LINE 的網頁分享連結只能帶文字和網址，平台沒有開放帶圖的參數；貼出的連結預覽圖來自 `og.png`。
- 這兩種分享不重疊，所以都留著：附圖分享用來炫耀成績，但對方收到的是一張點不進來的照片；LINE 連結分享會產生可點的連結預覽卡，才是把新玩家帶進來的那條路。
- 系統分享選單**只在 HTTPS（或 localhost）下存在**。用 `http://192.168.x.x` 在手機上測試時，「分享成績」會退回成複製文字或存圖；要驗證附圖分享必須部署到 HTTPS，或用隧道（例如 `cloudflared tunnel --url http://localhost:8000`）。
- LINE 會去抓分享的網址；區網或 localhost 網址抓不到，只有公開網址才會正常。
- 拿掉過 Facebook、Instagram 限時動態、Threads 三顆按鈕，別再加回來：
  - Facebook 自 2018 年起就把 `sharer.php` 的 `quote` 預填文字拿掉（防濫用），在手機上還會被 app 的 universal link 接走、落到不固定的頁面。
  - Instagram：Web Share 交出去的檔案不會出現「限時動態」這個目標，要直接開限動編輯器得用 `instagram-stories://share` + pasteboard，需要原生 app 與註冊的 Facebook App ID。
  - Threads：intent 只吃 `text`，成績圖帶不過去，貼出來只有 `og.png` 的通用連結卡，在動態牆上偏單薄。想帶成績圖的人用系統分享選單選 Threads 反而可行。

