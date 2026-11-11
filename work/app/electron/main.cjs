// Enable the built-in offline desktop mode before backend initialization.
process.env.MUSE_MASTER_MODE = '1';
const { app, BrowserWindow, ipcMain, session, screen, dialog } = require('electron');
const path = require('path');
app.setPath('userData', path.join(app.getPath('appData'), 'Musee'));
app.setName('MOPIX');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
const SERVER_PORT = 3001;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// Check if server is running
function checkServerReady(timeoutMs = 25000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(`${SERVER_URL}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry();
        }
      }).on('error', () => {
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error('Server start timed out'));
      } else {
        setTimeout(check, 500);
      }
    };

    check();
  });
}

// Bản đóng gói: chạy server ngay trong tiến trình Electron (máy người dùng không cần cài Node).
// Dữ liệu mỗi người lưu ở %APPDATA%\Muse Batch Manager\data, không nằm trong thư mục app.
function dataDir() {
  // Windows portable: có thư mục "data" cạnh file exe thì dùng luôn nó, để copy cả thư mục app sang máy khác
  // là mang theo ảnh, lịch sử video, tài khoản. Không có thì dùng %APPDATA%.
  if (process.platform === 'win32') {
    const portable = path.join(path.dirname(process.execPath), 'data');
    if (require('fs').existsSync(portable)) return portable;
  }
  return path.join(app.getPath('userData'), 'data');
}

function startServerInProcess() {
  const fs = require('fs');
  fs.mkdirSync(dataDir(), { recursive: true });
  process.env.MUSE_DATA_DIR = dataDir();
  process.env.MUSE_APP_DIR = path.join(__dirname, '..');
  process.env.PORT = String(SERVER_PORT);

  // Ghi log server ra file để gửi lại khi có lỗi
  const log = fs.createWriteStream(path.join(dataDir(), 'server.log'), { flags: 'w' });
  const write = (level, args) => {
    const line = args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    log.write(`[${new Date().toLocaleTimeString()}] ${level} ${line}\n`);
  };
  console.log = (...a) => write('INFO', a);
  console.warn = (...a) => write('WARN', a);
  console.error = (...a) => write('ERROR', a);
  process.on('uncaughtException', (err) => write('FATAL', [err]));

  require(path.join(__dirname, '..', 'dist', 'server', 'index.js'));
}

// Tắt các trình duyệt chạy ẩn của worker (profile nằm trong thư mục dữ liệu) - Windows và Mac
function killWorkerBrowsers() {
  try {
    const { killBrowsersUsing } = require(path.join(__dirname, '..', 'dist', 'server', 'procUtil.js'));
    killBrowsersUsing(path.join(dataDir(), 'profiles'));
  } catch {
    // ignore
  }
}

// Mac: cần menu Edit thì Cmd+C / Cmd+V / Cmd+A mới hoạt động trong app
function setupMacMenu() {
  if (process.platform !== 'darwin') return;
  const { Menu } = require('electron');
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu', label: 'MOPIX' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ])
  );
}

// Start backend server (bản dev: chạy bằng Node + tsx từ mã nguồn)
function startServer() {
  const serverPath = path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const serverFile = path.join(__dirname, '..', 'server', 'index.ts');

  console.log('[Electron] Starting backend server...');
  // Chạy bằng Node hệ thống (process.execPath là electron.exe, không chạy được server và lệch ABI của better-sqlite3)
  // Chạy ẩn (không bật cửa sổ console), log ghi vào data/server.log
  const fs = require('fs');
  const logFile = path.join(__dirname, '..', 'data', 'server.log');
  const out = fs.openSync(logFile, 'w');
  serverProcess = spawn('node', [serverPath, serverFile], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(SERVER_PORT) },
    stdio: ['ignore', out, out],
    windowsHide: true
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron] Failed to start server process:', err);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[Electron] Server process exited with code ${code}`);
  });
}

function createMainWindow() {
  const area=screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1600, area.width),
    height: Math.min(1000, area.height),
    minWidth: 1024,
    minHeight: 700,
    title: 'MOPIX',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#08090a',
    webPreferences: {
      zoomFactor: 1.15,
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
      webSecurity: false // allow local media serving
    },
    autoHideMenuBar: true,
    show: false,
  });

  mainWindow.loadURL(SERVER_URL + '/?ui=linear-20261111-r2');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[Electron] Main window visible');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle native browser login for Muse AI
ipcMain.handle('open-login-window', async (_event, { url, identifier, accountId }) => {
  const targetUrl = url || 'https://muse.ai/login';
  const partitionName = `persist:account_${accountId || 'default'}`;
  const customSession = session.fromPartition(partitionName);

  const loginWindow = new BrowserWindow({
    width: 900,
    height: 750,
    parent: mainWindow,
    modal: true,
    title: `Đăng nhập Muse AI - ${identifier || 'Tài khoản'}`,
    webPreferences: {
      session: customSession,
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  loginWindow.loadURL(targetUrl);

  // Monitor cookie changes
  const checkCookies = async () => {
    try {
      const cookies = await customSession.cookies.get({ domain: 'muse.ai' });
      if (cookies && cookies.length > 0) {
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        console.log(`[Electron] Captured ${cookies.length} cookies for ${identifier}`);
        
        // Notify main window
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('cookie-captured', {
            accountId,
            identifier,
            cookie: cookieString,
          });
        }
      }
    } catch (e) {
      console.error('[Electron] Cookie extraction error:', e);
    }
  };

  loginWindow.webContents.on('did-finish-load', () => {
    checkCookies();
  });

  loginWindow.on('close', async () => {
    await checkCookies();
  });

  return { success: true };
});

// Chỉ cho mở 1 cửa sổ app; bấm lại exe thì đưa cửa sổ cũ lên
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!singleInstance) return;
  setupMacMenu();
  try {
    const alreadyRunning = await checkServerReady(1500).catch(() => false);
    if (!alreadyRunning) {
      if (app.isPackaged) {
        startServerInProcess();
      } else {
        startServer();
      }
      await checkServerReady(60000);
    }
    createMainWindow();
  } catch (err) {
    console.error('[Electron] Error launching application:', err);
    createMainWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Tắt cả cây tiến trình (server + các Edge chạy ẩn mà worker mở) - bản dev
function stopServer() {
  if (serverProcess && serverProcess.pid) {
    try {
      if (process.platform === 'win32') {
        require('child_process').spawnSync('taskkill', ['/PID', String(serverProcess.pid), '/T', '/F']);
      } else {
        serverProcess.kill('SIGKILL');
      }
    } catch {
      serverProcess.kill();
    }
    serverProcess = null;
  }
}

// App chỉ có 1 cửa sổ: đóng cửa sổ là thoát hẳn (cả trên Mac), để không còn job chạy ngầm
app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  stopServer();
  if (app.isPackaged) killWorkerBrowsers();
});

ipcMain.handle('choose-code-project', async (event) => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id || !event.senderFrame.url.startsWith(SERVER_URL + '/')) throw Error('Invalid project picker caller');
  const result = await dialog.showOpenDialog(mainWindow, {title: 'Chọn thư mục mã nguồn', properties: ['openDirectory']});
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('choose-save-directory', async (event, currentPath) => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id || !event.senderFrame.url.startsWith(SERVER_URL + '/')) throw Error('Invalid folder picker caller');
  const defaultPath = typeof currentPath === 'string' && path.isAbsolute(currentPath) ? currentPath : app.getPath('downloads');
  const result = await dialog.showOpenDialog(mainWindow, {title: 'Chọn thư mục lưu ảnh và video', defaultPath, properties: ['openDirectory', 'createDirectory']});
  return result.canceled ? null : result.filePaths[0];
});

// Clear HTTP/render cache only. Cookies, storage, profiles and media are retained.
ipcMain.handle('muse-cache-info',async()=>({bytes:await session.defaultSession.getCacheSize()}));
ipcMain.handle('muse-cache-clear',async()=>{const before=await session.defaultSession.getCacheSize();await session.defaultSession.clearCache();return {before,after:await session.defaultSession.getCacheSize()}});
