"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browsersUsing = browsersUsing;
exports.killBrowsersUsingAsync = killBrowsersUsingAsync;
exports.killBrowsersUsing = killBrowsersUsing;
const child_process_1 = require("child_process");
// Tìm / tắt tiến trình trình duyệt (Edge, Chrome...) đang dùng một thư mục profile, theo dòng lệnh của tiến trình.
// Windows: PowerShell + Win32_Process. macOS/Linux: ps.
const BROWSER_NAMES_WIN = "Name='msedge.exe' OR Name='chrome.exe' OR Name='brave.exe'";
function psQuote(s) {
    return s.replace(/'/g, "''");
}
/** PID các tiến trình có dòng lệnh chứa `needle` (macOS/Linux). */
function unixPidsMatching(output, needle) {
    return output
        .split('\n')
        .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
        .filter((m) => !!m && m[2].includes(needle) && Number(m[1]) !== process.pid)
        .map((m) => Number(m[1]));
}
/** Có tiến trình trình duyệt nào đang mở profile chứa `needle` không. */
function browsersUsing(needle) {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            (0, child_process_1.execFile)('powershell.exe', [
                '-NoProfile',
                '-Command',
                `@(Get-CimInstance Win32_Process -Filter "${BROWSER_NAMES_WIN}" | Where-Object { $_.CommandLine -like '*${psQuote(needle)}*' -and $_.CommandLine -notmatch '--type=' }).Count`,
            ], { timeout: 20000, windowsHide: true }, (err, stdout) => resolve(!err && parseInt(String(stdout).trim(), 10) > 0));
        }
        else {
            (0, child_process_1.execFile)('ps', ['-axo', 'pid=,command='], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(!err && unixPidsMatching(String(stdout), needle).length > 0));
        }
    });
}
/** Như killBrowsersUsing nhưng không chặn server (dùng trong lúc app đang chạy job). */
function killBrowsersUsingAsync(needle) {
    return new Promise((resolve) => {
        if (process.platform === 'win32') {
            (0, child_process_1.execFile)('powershell.exe', [
                '-NoProfile',
                '-Command',
                `Get-CimInstance Win32_Process -Filter "${BROWSER_NAMES_WIN}" | Where-Object { $_.CommandLine -like '*${psQuote(needle)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
            ], { timeout: 30000, windowsHide: true }, () => resolve());
        }
        else {
            (0, child_process_1.execFile)('ps', ['-axo', 'pid=,command='], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
                if (!err) {
                    for (const pid of unixPidsMatching(String(stdout), needle)) {
                        try {
                            process.kill(pid, 'SIGKILL');
                        }
                        catch {
                            // đã thoát
                        }
                    }
                }
                resolve();
            });
        }
    });
}
/** Tắt mọi tiến trình trình duyệt đang mở profile chứa `needle` (đồng bộ). */
function killBrowsersUsing(needle) {
    try {
        if (process.platform === 'win32') {
            (0, child_process_1.spawnSync)('powershell.exe', [
                '-NoProfile',
                '-Command',
                `Get-CimInstance Win32_Process -Filter "${BROWSER_NAMES_WIN}" | Where-Object { $_.CommandLine -like '*${psQuote(needle)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
            ], { timeout: 30000, windowsHide: true });
        }
        else {
            const r = (0, child_process_1.spawnSync)('ps', ['-axo', 'pid=,command='], { timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
            for (const pid of unixPidsMatching(String(r.stdout || ''), needle)) {
                try {
                    process.kill(pid, 'SIGKILL');
                }
                catch {
                    // tiến trình đã thoát
                }
            }
        }
    }
    catch {
        // không tắt được thì thôi, lần mở sau sẽ dọn lại
    }
}
