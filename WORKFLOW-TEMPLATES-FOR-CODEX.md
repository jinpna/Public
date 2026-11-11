# 5 Workflow Template cho Node Canvas (app cũ) — Spec cho Codex

**File dữ liệu:** `workflow-templates.json` (cùng thư mục với file này).
**Nguồn:** NewTake Gallery (newtake.ai/show), xem miễn phí không đăng nhập ngày 2026-11-11.
**Nguyên tắc:** chỉ học CẤU TRÚC (loại node, thứ tự, cách nối, fan-in). Toàn bộ prompt viết lại
bằng lời MOPIX, không copy nguyên văn nội dung NewTake. Ảnh tham chiếu KHÔNG kèm theo —
người dùng tải ảnh của mình vào các node Ảnh rồi mới chạy.

## 1. 5 template

| # | Template | Thể loại | Nodes | Edges | Gốc NewTake |
|---|----------|----------|-------|-------|-------------|
| 1 | Phim hoạt hình ngắn · 12 shot (`tpl-big-antlers`) | Hoạt hình / Phim ngắn | 34 (Text 2, Image 20, Video 12) | 70 | BIG ANTLERS — Lucas Ai |
| 2 | Phim hành động · Giao hàng inline (`tpl-parkour-inline`) | Hành động / Live-action | 17 (Text 1, Image 10, Video 6) | 40 | PARKOUR SPEED INLINE — hermesy |
| 3 | Phiêu lưu điện ảnh · Đền sa mạc (`tpl-rin-jin`) | Phiêu lưu / Điện ảnh | 26 (Text 2, Image 8, Video 16) | 88 | RIN & JIN — DKJ STUDIO |
| 4 | MV ca nhạc · 12 Segment (`tpl-snapback-mv`) | MV / Ca nhạc | 20 (Text 2, Image 6, Video 12) | 54 | 다미-snapback MV — 맛집하이에나 |
| 5 | Hài ngắn · Selfie dọc 9:16 (`tpl-wanyang-selfie`) | Hài / Ngắn dọc | 7 (Text 1, Image 3, Video 3) | 17 | 운장 테레비에 출연한 와냥선생 — 관우 |

Điểm chung cả 5: lõi Ảnh → Video với khóa tham chiếu (bảng nhân vật / bối cảnh / đạo cụ
nối vào nhiều video). Template 1 và 4 có bước lắp ráp cuối, còn 2/3/5 đầu ra là các clip riêng.

## 2. Những chỗ đã phải điều chỉnh cho khớp app (nói rõ, không giấu)

| Giới hạn NewTake → MOPIX | Cách xử lý trong template |
|---|---|
| Video 15s / 30s | Chia thành clip 10s (giới hạn của app chỉ 5/10s). T5: 1 shot 30s → 3 phần 10s nối video → video. T3: 30s → 16 clip 10s. |
| Tỉ lệ 21:9 (RIN & JIN) | Đổi thành 16:9, ghi rõ trong node Text phong cách (app chỉ hỗ trợ 16:9 / 9:16 / 1:1). |
| Node Audio (12 lát audio ở MV, 1 audio 1:00 ở BIG ANTLERS) | App không có node Audio. Nhịp nhạc / hát nhép ghi trong prompt từng video; nhạc thêm ở bước lắp ráp ngoài canvas. |
| Node Smart Edit / lắp ráp cuối | App không có node này. Thay bằng node Text "Hoàn thiện" đứng riêng (KHÔNG có đường nối vào — app cấm nối vào node Text), nội dung hướng dẫn dùng tính năng Ghép video (Stitch) của app rồi thêm nhạc. |
| Bước HD (고화질 ở RIN & JIN) | Thành node Text "Nâng cấp HD" hướng dẫn sang màn Upscale 4K. |
| Workflow 45 node (MV gốc) | Nén còn 20 node (bỏ các bản sao / clip thử) để dưới giới hạn 40 node của canvas. |
| Ảnh tham chiếu gốc | Không có trong file. Mỗi node Ảnh có prompt mô tả ảnh cần tải + dòng "Upload your own image here". |

**Không tìm được trên Gallery:** workflow quảng cáo sản phẩm và giải thích SaaS có quy trình
công khai (nút "View Creation Process" bị khóa với ghi chú "The user hasn't made this canvas
public", vd "Runway Masterpieces 2026" mục thời trang). Nếu cần thêm 2 thể loại này thì làm
template mới theo cùng mẫu cấu trúc, không lấy từ Gallery.

## 3. Định dạng file (khớp `mopix-node-graph.js`)

```json
{ "version": 1, "source": "...", "templates": [
  { "id": "tpl-...", "name_vi": "...", "name_en": "...", "category": "...",
    "source_workflow": "TÊN — NewTake Gallery, tác giả ...",
    "source_note": "chỗ nào đã điều chỉnh và vì sao",
    "description": "...", "how_to_use_vi": "1) ... 2) ...",
    "nodes": [ {"id","kind","x","y","title","prompt","ratio","duration","style":"","preset":""} ],
    "edges": [ {"id","from","to"} ] } ] }
```

- `kind` chỉ `text` / `image` / `video`; `ratio` chỉ `16:9` / `9:16` / `1:1`;
  `duration` chỉ `5` / `10`; `title` ≤ 80 ký tự; `prompt` ≤ 20000 ký tự.
- Đã kiểm chứng bằng script `build-workflow-templates.py` (chạy lại để tái tạo file):
  nodes ≤ 40, edges ≤ 150, không cycle, không nối vào node Text, mỗi node Video
  tối đa 5 ảnh đầu vào. **Trước khi load template trong app, chạy `sanitizeGraph()`
  lên dữ liệu — template không hợp lệ thì báo lỗi, không tự sửa lặng lẽ.**

## 4. Quy tắc @image — Codex đọc kỹ

`@image1…@image5` trong prompt của node Video được gán theo **thứ tự đường nối ảnh
đi vào node đó** (hàm `incomingNodes` trả về theo thứ tự mảng `edges`). File template
đã sắp xếp edges đúng thứ tự này, ví dụ:

- T1: mỗi video nhận [storyboard → @image1, Bram → @image2, nai con → @image3].
- T2: mỗi video nhận [bảng nhân vật Sara → @image1, rồi 4 ảnh bối cảnh].
- T4: mỗi Segment nhận [bảng nhân vật → @image1, bảng mặt → @image2, Scene → @image3].
- T5: mỗi video nhận [mèo → @image1, nam chính → @image2, ba lô → @image3].

**Khi load template, giữ nguyên thứ tự mảng `edges` trong file. Đừng sort lại edges
theo id hay theo vị trí — sort lại là sai @image.**

## 5. Việc Codex cần làm (theo thứ tự)

1. **Chép file** `workflow-templates.json` vào app, ví dụ
   `work/app/dist/assets/data/workflow-templates.json`, fetch như kho motion
   (`mopix-motion-library-loader.js`).
2. **Thêm nút "Workflow mẫu" trên toolbar Canvas** (cạnh nút "Preset Motion"):
   mở modal liệt kê 5 template (tên + thể loại + mô tả + số node), bấm 1 template
   thì load vào canvas.
3. **Load = thay canvas hiện tại, có xác nhận.** Hiện dialog "Thay canvas hiện tại
   bằng template …?" — vì canvas hiện chỉ lưu 1 bản nháp. Trước khi thay, sao lưu
   bản nháp cũ sang key localStorage `mopix-node-canvas-backup` để không mất việc.
   Không tự ý append template vào canvas đang có (template là cả một workflow hoàn
   chỉnh, append sẽ rối + dễ vượt 40 node).
4. **Sau khi load:** chạy `sanitizeGraph()`; nếu lỗi thì báo rõ, giữ nguyên canvas cũ.
   Chọn node Video cuối rồi bấm "Chạy quy trình" phải chạy được cả chuỗi (xem mục 6.1).
5. **Hiển thị `how_to_use_vi`** trong modal template và trong panel trống của Canvas
   sau khi load, để người dùng biết phải tải ảnh vào node nào trước.

## 6. Lỗi Canvas đã soi ra ngày 2026-11-11 — sửa cùng đợt này (đã báo ông chủ trong chat)

Soi trực tiếp `mopix-node-canvas.js` / `mopix-node-graph.js` / `mopix-canvas-options.js`
/ `mopix-motion-template.js` trên Mac.

1. **P0 — "Chạy quy trình" chỉ chạy node đứng TRƯỚC node đang chọn** (`runWorkflow`
   đi ngược từ `targetId`), không chạy cả canvas; bấm trên node Text thì báo
   "Quy trình đã hoàn tất" dù không chạy gì. Sửa: thêm nút "Chạy toàn bộ Canvas"
   chạy từ mọi node gốc tới mọi node lá; nút cũ đổi tên thành "Chạy tới node này".
2. **P1 — Cảnh báo preflight bị coi như lỗi:** `run()` throw cả khi
   `guard.warnings` có nội dung (`mopix-node-canvas.js`, hàm `run`). Sửa: warnings
   chỉ hiện cảnh báo cho người dùng xác nhận, chỉ `guard.errors` mới chặn chạy.
3. **P1 — Chỉ lưu được 1 workflow duy nhất** (key localStorage `mopix-node-canvas`,
   không đặt tên / lưu nhiều / xuất-nhập). Sửa sau khi có template: thêm lưu nhiều
   workflow đặt tên (localStorage hoặc file), vì template chỉ có ý nghĩa khi người
   dùng giữ được nhiều workflow.
4. **P1 — Thư viện chưa xem được quy trình** đã tạo ra tác phẩm ("Xem quy trình" —
   README ghi P2 chưa làm). Thêm nút này trong chi tiết tác phẩm: mở canvas ở chế
   độ chỉ xem với đúng graph đã chạy.
5. **P2 — Thiếu loại node:** không có node Audio/nhạc, không có node Upscale trong
   canvas (phải ra ngoài làm). Ghi vào backlog; trước mắt node Text hướng dẫn đã
   đủ dùng trong 5 template này.
6. **P2 — Lặt vặt:** không có redo (chỉ Ctrl+Z undo), không nhân đôi node, nhánh
   song song vẫn chạy tuần tự (chưa chạy song song khi đủ điều kiện), tải lại trang
   là mất phân tích video tham chiếu (`sanitizeGraph` không giữ `analysis` /
   `analysisKey`, phải phân tích lại).

## 7. Không làm

- Không copy prompt / ảnh / video của NewTake nguyên văn vào app, không nhúng
  nội dung Gallery. Template chỉ mang cấu trúc + prompt viết lại.
- Không hứa hẹn Smart Edit, 60fps, hay node Audio — app chưa có các thứ đó.
- Không động vào app mới (mondayxinchao). Toàn bộ việc này là trên app cũ.
