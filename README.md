# MOPIX · Monday MUSE AI

Bản giao diện desktop đang sử dụng, chốt ngày 11/11/2026. Repo này lưu mã giao diện đã chỉnh sửa và bản runtime trích từ app hiện có; không phải mã TypeScript gốc trước khi biên dịch.

## Canvas và Motion · cập nhật 11/11/2026

- Canvas riêng: Text, Ảnh, Video; kéo node, nối dây có kiểm tra vòng lặp, pan/zoom, minimap, ẩn đường nối, undo và lưu bản nháp cục bộ. Chạy và xem kết quả từng node, không tự chạy toàn bộ luồng.
- Thứ tự đường nối ảnh quyết định `@image1`…`@image5`. Menu `@` hiện cả ảnh và `@Video1`… tương ứng với video đầu vào. Một node video nhận nhiều ảnh và clip tham chiếu.
- Clip tham chiếu được backend hiện có lấy khung mẫu và phân tích qua MUSE thành hướng dẫn chuyển động. Đây không phải direct video conditioning hay sao chép chuyển động từng frame.
- 12 phong cách Motion: poster Miushare / Bang Motion, công thức prompt/camera MOPIX. 5s = 1 cảnh; 10s = 2 cảnh nối tiếp, mỗi cảnh 5s. Không nhúng GSAP hay hứa đầu ra 60fps.
- Canvas có 40 preset video của app và 12 phong cách Motion. So sánh tạo hai tác vụ riêng, cùng prompt/ảnh/engine, khác phong cách. Cả hai node được giữ trên Canvas.
- Director trong Storyboard dùng MUSE đề xuất đúng 3 cảnh, mỗi cảnh 5s hoặc 10s. Người dùng sửa và duyệt bản đề xuất trước khi thay storyboard; chưa tạo media ở bước lập kế hoạch.
- Kho 50 motion mới đang chờ file thật; loader kiểm tra schema, ID duy nhất và thời lượng, không điền dữ liệu giả. Tệp chờ: `work/app/dist/assets/data/motion-library.json`.
- P2 chưa triển khai: sơ đồ camera 2D/3D và xem workflow theo tác phẩm trong Thư viện. Không sao chép workflow NewTake hay nhập mẫu Miushare chưa kiểm chứng.

Kiểm tra: `npm run check:canvas`. Các bài kiểm tra trình duyệt mô phỏng API tạo media; chưa tiêu hao lượt MUSE để kiểm chứng chất lượng video thật.

## Giao diện hiện tại

- Dark mode thống nhất; Alpha Lyrae Medium lưu trong app; Inter Tight dự phòng cho dấu tiếng Việt còn thiếu. Tắt contextual alternates trong thao tác để không tự biến chữ thành pixel.
- Trang chủ tạo nhanh ảnh/video, ảnh demo và hiệu ứng chuyển cảnh.
- Tiêu đề sáng tạo cố định, không đổi liên tục; 9 ảnh demo, có ghi nguồn trong `assets/carousel/sources.json`.
- Tạo ảnh/video và trợ lý MUSE yêu cầu tài khoản bật và đã đăng nhập; máy chủ cũng kiểm tra phiên. Upscale 4K dùng độc lập.
- Preview của từng tab bắt đầu trống; chỉ hiện tác vụ vừa tạo hoặc kết quả người dùng chọn. Lịch sử Upscale tách khỏi các tab tạo.
- Bốn tab dùng chung kích thước cột, ô ảnh, prompt và thanh Tạo; thư mục lưu chỉ xuất hiện trong Cài đặt.
- Tạo ảnh có 10 nút cố định ở bên phải, cấu hình khung hình, ánh sáng, bố cục và vai trò ảnh. Bấm lại nút đã chọn để tinh chỉnh.
- Chỉnh ảnh có xóa watermark/logo; bấm lại để khoanh vùng cần xử lý.
- Tab Prompt nâng cao cho ảnh/video: prompt và JSON, vai trò tham chiếu, timeline, kiểm tra xung đột, sao chép và chuyển sang tab tạo. MUSE chỉ được gọi khi bấm tối ưu; bộ biên soạn cấu trúc dùng được ngoại tuyến.
- 50 demo Recraft với prompt gốc và nguồn, chia 7 nhóm do MOPIX phân loại. Ảnh xem trước raster, kể cả nhóm minh họa vector.
- Shape 3D: canvas WebGL từ MOPIX Studio, hình mẫu và nhập SVG/ảnh/GLB/OBJ, chỉnh hình khối/vật liệu/ánh sáng, xuất PNG/GLB hoặc dùng làm ảnh tham chiếu. Tạo ảnh hoàn thiện qua MUSE vẫn yêu cầu đăng nhập.
- Video có ghép 2–8 clip, cắt đoạn, đổi thứ tự, giữ âm thanh, cắt thẳng/hòa tan và lưu vào thư viện; tối đa 5 phút.
- Storyboard tối đa 8 cảnh, dùng hướng sáng tạo và ảnh chung, tạo ảnh từng cảnh rồi video từ keyframe; chuyển các clip hoàn tất sang ghép.
- AI gợi ý trong các ô prompt chính: xem, sửa và áp dụng đề xuất; thao tác icon có tên truy cập và tooltip.
- Chỉnh ảnh, thiết kế concept, video, Upscale 4K và thư viện.
- Nút Tạo nền tối, viền sáng chuyển động; preview/loading gọn.
- So sánh ảnh bằng thanh kéo trái/phải hoặc trên/dưới, dùng chung cho preview tạo/chỉnh ảnh và Upscale 4K; có phím mũi tên, Home/End.
- Preview 4K zoom theo con trỏ bằng transform, kéo để di chuyển, thao tác icon và xóa từng mục gần đây. Xóa gần đây giữ nguyên ảnh trong thư viện.
- Trạng thái chờ dùng lưới chấm chuyển động với câu chữ luân phiên; tôn trọng chế độ giảm chuyển động.
- Tham chiếu ảnh theo thứ tự @image1…@image5; menu @ có ảnh nhỏ, giữ mã tài nguyên thật khi gửi API.
- 12 phong cách Motion: poster Miushare / Bang Motion, công thức prompt và camera do MOPIX biên soạn lại. 5s = một cảnh; 10s = hai cảnh liên tục, mỗi cảnh 5s. Không nhúng trình chạy GSAP, không cam kết đầu ra 60fps.
- Loader kho 50 motion đã sẵn sàng, dữ liệu đang rỗng để chờ file thật từ người dùng.
- Đã bỏ giao diện Làm phim và phần cài đặt proxy.

## Cấu trúc để sửa tiếp

| Đường dẫn | Nội dung |
| --- | --- |
| `work/app/dist/assets/app/` | Các module giao diện JavaScript có thể sửa trực tiếp |
| `work/app/dist/assets/app/mopix-linear.css` | Theme và các quy tắc giao diện đang áp dụng |
| `work/app/dist/server/` | Backend đã biên dịch và các module bổ sung |
| `work/app/electron/` | Cửa sổ desktop và preload |
| `work/app/dist/assets/` | Font, logo và tài nguyên demo |
| `work/build-mopix-css.cjs` | Gộp CSS và cập nhật fingerprint để tránh cache cũ |

## Chạy và xem thử

Cần Node.js 22.13 trở lên, npm, Python 3; các bài kiểm tra giao diện dùng Google Chrome đã cài.

```sh
npm install
npm --prefix work/app install
npm run build:css
npm run start:server
```

Backend mặc định chạy cổng 3001. Nếu app desktop đang mở thì dùng backend của app thay vì chạy thêm một backend trùng cổng.

Ở cửa sổ terminal khác:

```sh
npm run preview
```

Mở `http://127.0.0.1:3008`. Preview lấy giao diện từ repo và chuyển yêu cầu API tới backend cổng 3001. Tài khoản, cookie và ảnh/video cá nhân không nằm trong repo.

```sh
npm run check:tools
npm run check:fonts
npm run check:no-film
npm run check:layout
npm run check:upscale
npm run check:creative
npm run check:creation-tools
```

Các kiểm tra này chỉ thao tác giao diện bằng trình duyệt thử nghiệm, không gửi tác vụ tạo ảnh/video.
Kiểm tra layout so sánh tọa độ các thành phần ở 1440×900, 1390×800 và 1024×700, đồng thời kiểm tra các phương thức đăng nhập, hộp tùy chọn, quote và QR.

## Cập nhật app đang cài trên macOS

Quy trình hiện tại cần `/Applications/Monday MUSE AI.app` đã cài; nó dùng app này làm nền đóng gói. Repo chưa có quy trình tạo bộ cài độc lập từ đầu hoặc runtime vendor cho các nền tảng khác.

1. Sửa module giao diện/CSS rồi chạy `npm run build:css` và kiểm tra preview.
2. Chạy `npm run package:installed` để tạo archive đã kiểm tra trong `work/`.
3. Đảm bảo không còn tác vụ đang chạy và thoát app.
4. Chạy `python3 work/install-mopix.py`, sau đó mở lại app.

Script cài đặt giữ bản sao app trước cập nhật và ký lại app cục bộ. Không commit các archive, bản sao lưu hoặc thư mục dữ liệu người dùng.

Font Inter Tight có giấy phép đi kèm tại `work/app/dist/assets/InterTight-OFL.txt`; các giấy phép tài nguyên khác nằm trong `work/app/dist/assets/licenses/`.

## Workflow mẫu trong Canvas

Preset Motion trên toolbar mở 5 workflow hoàn chỉnh (7–34 node). Nạp workflow thay Canvas sau xác nhận và sao lưu bản nháp cũ ở `mopix-node-canvas-backup`. Dữ liệu được kiểm tra bằng `sanitizeGraph`; thứ tự edges được giữ nguyên để tham chiếu `@image1`–`@image5` đúng ảnh. Các node yêu cầu ảnh riêng phải được tải ảnh trước khi chạy.

“Chạy toàn bộ Canvas” chạy mọi nhánh theo thứ tự phụ thuộc; “Chạy tới node này” chỉ chạy phần dẫn tới node được chọn. Kết quả hoàn tất được dùng lại. Lỗi preflight chặn gửi; cảnh báo cần xác nhận trước khi tiếp tục. Video tham chiếu được phân tích khung mẫu thành prompt, không phải điều kiện video trực tiếp. Chưa có node Audio hoặc tự ghép phim cuối trong Canvas.

Kiểm tra: `npm run check:workflows` dùng API MUSE mô phỏng, xác nhận chuỗi Wanyang 3 clip, nhánh độc lập, thứ tự ảnh, sao lưu, hủy nạp, dữ liệu lỗi và cảnh báo. Không dùng lượt tạo AI thực tế.
