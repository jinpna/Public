const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('fs');
const base=process.env.MOPIX_TEST_URL||'http://localhost:3008';
(async()=>{
 fs.mkdirSync('outputs',{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const nav=()=>page.getByRole('navigation',{name:'Điều hướng chính'});
 const tabs=['Tạo ảnh','Chỉnh ảnh','Thiết kế','Video'];
 for(const size of [{width:1440,height:900},{width:1390,height:800},{width:1024,height:700}]){
  await page.setViewportSize(size);await page.goto(base);
  let reference;
  for(const tab of tabs){
   await nav().getByRole('button',{name:tab,exact:true}).click();
   const report=await page.locator('main').last().evaluate(main=>{
    const rect=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)/10)};
    const composer=main.children[0],tools=main.children[2];
    return {
     columns:[...main.children].map(rect),
     input:rect(composer.querySelector('.quick-reference-strip,.sx-strip-empty')),
     prompt:rect(composer.querySelector('.muse-prompt-editor')),
     action:rect(composer.querySelector('.muse-compose-actions>button')),
     folder:rect(composer.querySelector('.mopix-output-folder')),
     toolsOverflow:tools.scrollHeight-tools.clientHeight,
     scroll:document.documentElement.scrollHeight>innerHeight,
     clipped:[...composer.querySelectorAll('button,select'),...tools.querySelectorAll('button')].filter(e=>{
      if(!e.getClientRects().length)return false;
      const r=e.getBoundingClientRect(),host=(composer.contains(e)?composer:tools).getBoundingClientRect();
      return r.bottom>host.bottom+1||r.top<host.top-1;
     }).map(e=>e.textContent.trim()),
     tileFont:tools.querySelector('.image-preset-grid>button')?getComputedStyle(tools.querySelector('.image-preset-grid>button')).fontSize:null
    };
   });
   assert(!report.scroll,`${tab}: page scroll`);
   assert(report.toolsOverflow<=1,`${tab}: tools overflow ${report.toolsOverflow}`);
   assert.deepEqual(report.clipped,[],`${tab}: clipped controls`);
   const geometry=Object.fromEntries(['columns','input','prompt','action','folder'].map(k=>[k,report[k]]));
   if(reference)assert.deepEqual(geometry,reference,`${size.width}: ${tab} differs from image workspace`);
   else reference=geometry;
   if(['Tạo ảnh','Chỉnh ảnh'].includes(tab))assert.equal(report.tileFont,'13px');
   await page.screenshot({path:`outputs/workspace-${size.width}-${tabs.indexOf(tab)}.png`});
  }
  console.log('Shared workspace geometry verified',size);
 }
 await nav().getByRole('button',{name:'Video',exact:true}).click();
 await page.getByRole('button',{name:'Khóa tham chiếu & rút gọn prompt',exact:true}).click();
 await page.locator('dialog:modal').waitFor();await page.getByRole('button',{name:'Đóng tùy chọn'}).click();
 await nav().getByRole('button',{name:'Cài đặt',exact:true}).click();
 for(const mode of ['Mở trình duyệt','Dán Cookie','Mật khẩu']){
  await page.getByRole('button',{name:mode,exact:true}).click();
  const overflow=await page.locator('.muse-settings-content').evaluate(e=>e.scrollHeight-e.clientHeight);
  assert(overflow<=1,`Account ${mode} overflow ${overflow}`);
 }
 await page.getByRole('navigation',{name:'Mục cài đặt'}).getByRole('button',{name:'Ứng dụng'}).click();
 assert.equal(await page.getByRole('button',{name:'Chọn thư mục lưu'}).count(),1);
 await page.clock.install();
 await nav().getByRole('button',{name:'Trang chủ',exact:true}).click();
 const first=await page.locator('.mopix-creative-quote').innerText();
 await page.clock.fastForward(4100);
 assert.notEqual(await page.locator('.mopix-creative-quote').innerText(),first);
 assert.equal(await page.locator('.alara-image-stage>img').count(),9);
 assert.equal(await page.getByText('MOPIX / CREATIVE STUDIO',{exact:true}).count(),0);
 assert.equal(await page.locator('a[href^="mailto:monday.directory@gmail.com"]').count(),1);
 await page.getByRole('button',{name:'Ủng hộ Monday',exact:true}).click();
 const qr=page.locator('.donate-qr img');
 await qr.waitFor();await qr.evaluate(e=>e.decode());assert(await qr.evaluate(e=>e.complete&&e.naturalWidth>0));
 await page.screenshot({path:'outputs/donate-compact.png'});
 assert.deepEqual(errors,[]);
 await browser.close();console.log('Account modes, option dialog, quotes, demo images and donation verified');
})().catch(e=>{console.error(e);process.exit(1)});
