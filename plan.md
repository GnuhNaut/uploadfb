# Project: Telegram to Facebook Auto-Poster (Node.js)

## 1. Mục tiêu hệ thống
Xây dựng một dịch vụ chạy ngầm trên Node.js để theo dõi (monitor) một hoặc nhiều channel Telegram, tải nội dung (Text, Image, Video) và tự động đăng tải lên Facebook (Fanpage/Group/Profile).

## 2. Công nghệ yêu cầu
- **Runtime:** Node.js (v18+)
- **Telegram Client:** `gramjs` (MTProto API) - Cho phép đọc dữ liệu từ channel bất kỳ (không cần làm Admin).
- **Facebook Integration:** - Option A: `facebook-nodejs-business-sdk` (Graph API) cho Fanpage.
    - Option B: `playwright` (Chromium) cho Profile cá nhân/Group.
- **Database:** `SQLite` hoặc `Lowdb` để lưu vết `last_message_id` (tránh đăng trùng).
- **Process Manager:** `PM2`
- **File Management:** `fs-extra`, `axios`

## 3. Kiến trúc Module

### Module 1: Telegram Scraper (GramJS)
- Kết nối bằng `api_id` và `api_hash` (từ my.telegram.org).
- Sử dụng cơ chế `NewMessageHandler` để lắng nghe bài viết mới theo thời gian thực.
- Logic lọc: Chỉ lấy tin nhắn có chứa Media (Photo/Video) hoặc Text cụ thể.

### Module 2: Media Processor
- Tải file từ Telegram về thư mục `/temp`.
- Kiểm tra dung lượng file (Video > 1GB cần cảnh báo hoặc bỏ qua).
- Tự động xóa file trong `/temp` sau khi hoàn thành chu kỳ đăng bài.

### Module 3: Facebook Publisher
- **Nếu dùng API:** Cần cấu hình `Page Access Token` và logic `POST /photos` hoặc `POST /videos`.
- **Nếu dùng Playwright:** Viết script login bằng Cookie (để tránh checkpoint), navigate tới URL đăng bài, upload file và nhấn Post.

## 4. Quy trình xử lý (Workflow)
1. Khởi động Client Telegram.
2. Kiểm tra Database tìm `message_id` cuối cùng đã xử lý.
3. Lắng nghe tin nhắn mới.
4. Tải Media -> Lưu vào local.
5. Gọi hàm Publish sang Facebook.
6. Nếu thành công -> Cập nhật `message_id` vào Database.
7. Nếu thất bại -> Ghi log lỗi và gửi thông báo qua Telegram Bot cá nhân (Alert).

## 5. Yêu cầu đặc biệt cho AI Agent
- Code phải có xử lý lỗi (Error Handling) chặt chẽ, đặc biệt là lỗi Timeout khi tải video nặng.
- Implement cơ chế **Rate Limiting**: Không đăng quá 5 bài/giờ để tránh bị Facebook đánh spam.
- Cấu hình biến môi trường qua file `.env`.