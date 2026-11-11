'use strict';
// Only the app's isolated MUSE profile is cleared; keep the account and job history.
function createDisconnectHandler({db,browserManager,museWorker,profileDirFor,fs,getAccounts,broadcast}){
 const locks=new Set();
 return async function disconnect(req,res){
  const id=req.params.id;
  if(locks.has(id))return res.status(409).json({error:'Tài khoản đang được ngắt kết nối. Vui lòng chờ.'});
  const account=db.prepare('SELECT id, jobs_running FROM accounts WHERE id = ?').get(id);
  if(!account)return res.status(404).json({error:'Không tìm thấy tài khoản MUSE.'});
  const running=db.prepare("SELECT id FROM jobs WHERE account_id = ? AND status = 'running' LIMIT 1").get(id);
  if(account.jobs_running>0||running)return res.status(409).json({error:'Tài khoản đang tạo ảnh hoặc video. Hãy chờ tác vụ hoàn tất rồi ngắt kết nối.'});
  locks.add(id);
  try{
   db.prepare("UPDATE accounts SET enabled = 0, status = 'offline', session_status = 'Đang đăng xuất…' WHERE id = ?").run(id);
   await browserManager.closeSession(id);
   await museWorker.closeBrowser(id);
   fs.rmSync(profileDirFor(id),{recursive:true,force:true});
   db.prepare("UPDATE accounts SET credentials_encrypted = NULL, enabled = 0, status = 'offline', session_status = 'Đã đăng xuất', usage_tokens_left = NULL, usage_checked_at = NULL, paused_until = NULL WHERE id = ?").run(id);
   broadcast('ACCOUNTS_UPDATED',getAccounts());
   return res.json({success:true});
  }catch{
   db.prepare("UPDATE accounts SET status = 'offline', session_status = 'Chưa đăng xuất hoàn tất' WHERE id = ?").run(id);
   broadcast('ACCOUNTS_UPDATED',getAccounts());
   return res.status(500).json({error:'Chưa đăng xuất hoàn tất. Tài khoản đã tạm ngưng; vui lòng thử lại.'});
  }finally{locks.delete(id)}
 }
}
module.exports={createDisconnectHandler};
