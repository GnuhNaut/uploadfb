import axios from 'axios';
import readline from 'readline/promises';
import dotenv from 'dotenv';
dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log("==================================================");
  console.log("=== CÔNG CỤ LẤY PAGE ACCESS TOKEN VĨNH VIỄN ===");
  console.log("==================================================");
  console.log("Lưu ý trước khi bắt đầu:");
  console.log("Truy cập trang Graph API Explorer: https://developers.facebook.com/tools/explorer/");
  console.log("Tạo một User Access Token (Token Người Dùng) ngắn hạn với các quyền: pages_show_list, pages_manage_posts, pages_read_engagement");
  
  const appId = await rl.question("\n1. Nhập Facebook App ID: ");
  const appSecret = await rl.question("2. Nhập Facebook App Secret (Mã bảo mật): ");
  const shortToken = await rl.question("3. Nhập Short-lived User Token vừa tạo: ");
  
  try {
    console.log("\n▶ [1/2] Đang đổi lấy Long-lived User Token (Token User Dài Hạn)...");
    const res1 = await axios.get(`https://graph.facebook.com/v19.0/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId.trim(),
        client_secret: appSecret.trim(),
        fb_exchange_token: shortToken.trim()
      }
    });
    
    const longToken = res1.data.access_token;
    console.log("✅ Thành công lấy Long-lived User Token!");

    console.log("\n▶ [2/2] Đang trích xuất Page Access Token vĩnh viễn từ các Page bạn quản lý...");
    const res2 = await axios.get(`https://graph.facebook.com/v19.0/me/accounts`, {
      params: {
        access_token: longToken
      }
    });

    const pages = res2.data.data;
    if (!pages || pages.length === 0) {
      console.log("\n❌ Không tìm thấy Fanpage nào được kết nối với tài khoản này. Hãy kiểm tra lại các quyền cấp cho Token.");
    } else {
      console.log("\n🎉 KẾT QUẢ: DANH SÁCH PAGE ACCESS TOKEN VĨNH VIỄN (NEVER EXPIRE):");
      console.log("--------------------------------------------------");
      pages.forEach((page, index) => {
        console.log(`[TRANG ${index + 1}]: ${page.name}`);
        console.log(`👉 Page ID: ${page.id}`);
        console.log(`🔑 Vĩnh viễn Token (Hãy copy dòng dưới vào file .env):`);
        console.log(`${page.access_token}\n`);
      });
      console.log("--------------------------------------------------");
      console.log("Lưu ý: Thay thế chuỗi Token trên vào dòng FB_PAGE_ACCESS_TOKEN trong file .env nhé!");
    }

  } catch (error) {
    console.error("\n❌ LỖI TRONG QUÁ TRÌNH LẤY TOKEN:");
    console.error(error.response?.data?.error?.message || error.message);
  } finally {
    rl.close();
  }
}

main();
