# MOPIX · Monday MUSE AI

Bản giao diện desktop đang sử dụng, chốt ngày 11/11/2026. Repo này lưu mã giao diện đã chỉnh sửa và bản runtime trích từ app hiện có; không phải mã TypeScript gốc trước khi biên dịch.

## Giao diện hiện tại

- Dark mode thống nhất; Inter Tight Regular 400 lưu trực tiếp trong app.
- Trang chủ tạo nhanh ảnh/video, ảnh demo và hiệu ứng chuyển cảnh.
- Tạo ảnh có 10 nút công cụ cố định ở bên phải, tự điền yêu cầu.
- Chỉnh ảnh, thiết kế concept, video, Upscale 4K và thư viện.
- Nút Tạo nền tối, viền sáng chuyển động; preview/loading gọn.
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

Cần Node.js, npm, Python 3; các bài kiểm tra giao diện dùng Google Chrome đã cài.

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
```

Các kiểm tra này chỉ thao tác giao diện bằng trình duyệt thử nghiệm, không gửi tác vụ tạo ảnh/video.

## Cập nhật app đang cài trên macOS

Quy trình hiện tại cần `/Applications/Monday MUSE AI.app` đã cài; nó dùng app này làm nền đóng gói. Repo chưa có quy trình tạo bộ cài độc lập từ đầu hoặc runtime vendor cho các nền tảng khác.

1. Sửa module giao diện/CSS rồi chạy `npm run build:css` và kiểm tra preview.
2. Chạy `npm run package:installed` để tạo archive đã kiểm tra trong `work/`.
3. Đảm bảo không còn tác vụ đang chạy và thoát app.
4. Chạy `python3 work/install-mopix.py`, sau đó mở lại app.

Script cài đặt giữ bản sao app trước cập nhật và ký lại app cục bộ. Không commit các archive, bản sao lưu hoặc thư mục dữ liệu người dùng.

Font Inter Tight có giấy phép đi kèm tại `work/app/dist/assets/InterTight-OFL.txt`; các giấy phép tài nguyên khác nằm trong `work/app/dist/assets/licenses/`.
