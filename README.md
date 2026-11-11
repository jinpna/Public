# MOPIX · Monday MUSE AI

Bản giao diện desktop đang sử dụng, chốt ngày 11/11/2026. Repo này lưu mã giao diện đã chỉnh sửa và bản runtime trích từ app hiện có; không phải mã TypeScript gốc trước khi biên dịch.

## Giao diện hiện tại

- Dark mode thống nhất; Inter Tight Regular 400 lưu trực tiếp trong app.
- Trang chủ tạo nhanh ảnh/video, ảnh demo và hiệu ứng chuyển cảnh.
- 20 câu ngắn về sáng tạo đổi mỗi 4 giây; 9 ảnh demo, có ghi nguồn trong `assets/carousel/sources.json`.
- Tạo ảnh/video và trợ lý MUSE yêu cầu tài khoản bật và đã đăng nhập; máy chủ cũng kiểm tra phiên. Upscale 4K dùng độc lập.
- Preview của từng tab bắt đầu trống; chỉ hiện tác vụ vừa tạo hoặc kết quả người dùng chọn. Lịch sử Upscale tách khỏi các tab tạo.
- Bốn tab dùng chung kích thước cột, ô ảnh, prompt và thanh Tạo; lựa chọn thư mục lưu đồng bộ qua cài đặt.
- Tạo ảnh có 10 nút cố định ở bên phải, cấu hình khung hình, ánh sáng, bố cục và vai trò ảnh. Bấm lại nút đã chọn để tinh chỉnh.
- Chỉnh ảnh có xóa watermark/logo; bấm lại để khoanh vùng cần xử lý.
- Tab Prompt nâng cao cho ảnh/video: prompt và JSON, vai trò tham chiếu, timeline, kiểm tra xung đột, sao chép và chuyển sang tab tạo. MUSE chỉ được gọi khi bấm tối ưu; bộ biên soạn cấu trúc dùng được ngoại tuyến.
- 50 demo Recraft với prompt gốc và nguồn, chia 7 nhóm do MOPIX phân loại. Ảnh xem trước raster, kể cả nhóm minh họa vector.
- Chỉnh ảnh, thiết kế concept, video, Upscale 4K và thư viện.
- Nút Tạo nền tối, viền sáng chuyển động; preview/loading gọn.
- So sánh ảnh bằng thanh kéo trái/phải hoặc trên/dưới, dùng chung cho preview tạo/chỉnh ảnh và Upscale 4K; có phím mũi tên, Home/End.
- Preview 4K zoom theo con trỏ bằng transform, kéo để di chuyển, thao tác icon và xóa từng mục gần đây. Xóa gần đây giữ nguyên ảnh trong thư viện.
- Trạng thái chờ dùng lưới chấm chuyển động với câu chữ luân phiên; tôn trọng chế độ giảm chuyển động.
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
