# 把茶間小人放進簡報

## 3 步嵌入

1. 把整個 `library/` 資料夾複製到簡報的 `index.html` 旁邊，保留資料夾結構。
2. 在簡報的 `<head>` 裡加入這兩行：

   ```html
   <link rel="stylesheet" href="library/tea-characters.css">
   <script type="module" src="library/tea-characters.js"></script>
   ```

3. 在想出現小人的位置放標籤：

   ```html
   <tea-chara name="xiaoye" action="idle" size="220"></tea-chara>
   ```

上傳到 GitHub Pages 後即可使用，包含放在專案子路徑的簡報。不需要安裝套件，也不連外載入字型或程式。小人會跟隨標籤出現的位置。

本機預覽要透過 HTTP 開啟，不能直接雙擊 HTML：在簡報資料夾執行 `python3 -m http.server 8765`，瀏覽器開啟 `http://localhost:8765/demo.html`（簡報則開 `index.html`）。

## 換動作與大小

| 屬性 | 怎麼用 |
|---|---|
| `name="xiaoye"` | 選角色，小葉用 `xiaoye`，奶茶用 `naicha`。 |
| `action="idle"` | 2.4 秒上下呼吸 2 px，並自然眨眼。 |
| `action="blink"` | 立即眨眼一次，之後保持呼吸與自然眨眼。 |
| `action="wave"` | 雙手一起揮 3 次，每次 0.6 秒；左右鏡像擺動，1.8 秒後 `action` 自動回到 `idle`。 |
| `loop` | 加上此屬性就持續雙手揮動；拿掉後再揮 3 次回待機。 |
| `action="float"` | 每 3 秒上下漂浮 6 px，底下有同步縮放的影子。 |
| `action="walk"` | 4 格走路，每格 0.15 秒，碰到父容器左右內緣就鏡像轉向；缺圖才回待機，console 只提醒一次。 |
| `size="220"` | 角色畫布高度 220 px，全部零件等比縮放。呼吸／漂浮位移與影子在畫布外另留約 12 px。 |
| `flip` | 左右鏡像。 |
| `show-pivots` | 顯示肩膀的粉紅軸心點，供調整用。 |

```html
<tea-chara name="xiaoye" action="wave" size="280" loop flip></tea-chara>
```

在投影片換頁時重新揮手，可用：

```js
document.querySelector('tea-chara').play('wave');
```

全部五個動作每 3–5 秒隨機眨眼一次，每次閉眼 0.12 秒。開啟作業系統「減少動態效果」時，全部改成靜態站姿，不眨眼、不漂浮、不揮手；設定改變會即時生效。頁籤隱藏時也會暫停，回來後重啟動作。移除元件時會清除計時器。

未知動作會退回 `idle` 並提醒；找不到角色／必要 PNG 時，畫面顯示「角色載入失敗」，並發出 `tea-error` 事件。成功後發出 `tea-ready`。可由 `data-state` 讀取 `loading / ready / error`，`data-action` 讀取實際執行的動作。

## 重切素材或新增角色

在工作資料夾執行：

```sh
python3 tools/cut_parts.py parts/naicha/sheet.png library/characters/naicha
```

切圖器以 alpha 連通區域抓完整零件，再用區域中心對應 3×3 順序，**不沿格線硬切**。第 1 列：head-blank、body、arm-l；第 2 列：arm-r、arm-r-wave、eye-open；第 3 列：eye-closed、mouth-smile、mouth-o。左右眼各自獨立，合在一張透明 PNG。每個零件預期單一區域，眼睛預期兩個；黏連／缺件會回傳 exit 1 並寫入 `REPORT.md`。極小雜點與 alpha ≤8 的殘色會清除，原圖不改。

小葉與奶茶的 manifest 已完成個別站姿校正；重跑會保留。其他新角色要依其 `reference.png` 調整新角色 `manifest.json`；預設取得小葉比例的起始座標，**需要人眼核對，不能直接視為定稿**。已切好的 RGBA PNG 也可以直接放入角色資料夾，再複製與修改 manifest；不必重切。若有獨立圍巾／葉芽，把 `accessory.png` 加進 `parts`，座標規則相同。

新增其他角色要讓 demo 多一列，在 `library/characters/index.json` 加入：

```json
{"name": "new-character", "label": "新角色", "note": "待驗收"}
```

## manifest 座標規則

- `schemaVersion: 1`；`canvas.width / height` 是設計畫布，小葉為 500 × 800，奶茶為 620 × 800。
- `parts` 以固定零件名稱為 key；`file` 是同資料夾 PNG 檔名。
- `x / y / width / height` 使用設計畫布單位，左上角為原點；`z` 越大越前面。
- `pivot.x / y` 是零件內的 0–1 比例；手臂以肩膀小圓點為軸心。定稿肩膀落在軀幹 x＝16%／84%、距頂端 12%；奶茶排除飄巾。`rotation` 為揮手基準角：小葉左 +15°／右 −15°、奶茶左 +20°／右 −20°；波動 ±15°，左手方向與右手相反，每次 0.6 秒。一般手臂維持 0°，所有手臂 z=1，在身體後方。
- `arm-l-wave.png` 由 `arm-r-wave.png` 以 Pillow `transpose(Image.Transpose.FLIP_LEFT_RIGHT)` 鏡像；位置、pivot 與 palm 依軀幹中線鏡像，`sourceBounds` 記錄原右手來源，`mirroredFrom` 標示鏡像來源。wave 同時隱藏一般左右手、顯示雙手揮動零件，回待機時還原。
- 可選 `rotation` 是靜態角度（度）；依各角色手臂方向向外微調，讓手掌露在身體外側。
- `sourceBounds` 是切圖後在 sheet 的 `[x,y,width,height]`；完整切圖資訊在 `extraction.json`。
- 重跑切圖會更新輸出 PNG 與來源位置，但保留既有 manifest 的組裝位置、尺寸與軸心；若換成不同畫稿，須同步調整尺寸比例。
- 若輸入資料夾存在 `walk-strip.png`，切圖器會自動用 alpha 連通區域抓出 4 個完整人物，不沿格線硬裁。四格等比例保留原始大小、統一畫布並對齊底部與中心，輸出 `walk-1..4.png`，寫入 `walkCanvas`、`walkFrames`。
- 每個角色另有 `walk-blink-1..4.png`，使用走路原圖眼睛上方的同圖紋理與原 `eye-closed` 眼皮生成閉眼副本，讓走路也會眨眼；不改來源圖。`walkBlinkFrames` 保存檔名，切圖器會記錄眼睛偵測結果供檢查。這個偵測適用本次兩種角色，其他風格必須檢查輸出。
- 走路使用 CSS `steps(4)`、0.6 秒一輪；兩組睜／閉眼圖保持相同影格進度。水平速度在 220 px 高度時為 42 px／秒，隨角色大小縮放。`flip` 會讓走路起始朝左；碰邊後自動改向。

## 走路容器

把走路小人放在**專用的、有寬度的容器**，寬度至少比角色寬，才有空間來回走；其他文字不要放在同一條走路路徑上。範例：

```html
<div style="width:100%;height:240px;display:flex;align-items:end;justify-content:center">
  <tea-chara name="naicha" action="walk" size="220"></tea-chara>
</div>
```

站姿與側面走路的寬高比不同，元件會隨動作調整寬度，高度仍維持 `size`。父容器窄到沒有可走空間時只原地踏步；要避免整個人物超出容器，請把 `size` 設得比容器可用寬度小。

`tests/` 與 `verification/` 是驗收資料，不參與網頁載入；發佈簡報時可省略。
