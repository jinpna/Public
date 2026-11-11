'use strict';
const MESSAGE='Đăng nhập tài khoản MUSE trước khi tạo ảnh hoặc video. Upscale 4K vẫn dùng độc lập.';
function hasMuseSession(db){return !!db.prepare("SELECT id FROM accounts WHERE enabled=1 AND status='online' AND credentials_encrypted IS NOT NULL AND credentials_encrypted<>'' LIMIT 1").get()}
function needsMuseSession(method,url){if(method!=='POST')return false;const p=url.split('?')[0];return /^\/api\/queue\/(preflight|enqueue|process|retry\/[^/]+)$/.test(p)||/^\/api\/(?:magnific\/generate|studio\/generate-all|concept\/analyze|prompt-assistant\/(?:improve|motion-reference\/analyze)|exact-video)$/.test(p)||/^\/api\/(?:films\/[^/]+\/generate|movie-studio\/[^/]+\/(?:plan|storyboards))$/.test(p)}
function installMuseAccess(app,db){app.get('/api/muse/session',(_req,res)=>res.json({authenticated:hasMuseSession(db)}));app.use((req,res,next)=>{if(needsMuseSession(req.method,req.path)&&!hasMuseSession(db))return res.status(401).json({error:MESSAGE,code:'MUSE_LOGIN_REQUIRED'});next()})}
module.exports={hasMuseSession,needsMuseSession,installMuseAccess,MESSAGE};
