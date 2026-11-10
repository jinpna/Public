"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initWebSocket = initWebSocket;
exports.broadcast = broadcast;
exports.getWss = getWss;
const ws_1 = require("ws");
let wss = null;
function initWebSocket(server) {
    wss = new ws_1.WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => {
        try {
            ws.send(JSON.stringify({
                type: 'CONNECTED',
                payload: {
                    message: 'Kết nối máy chủ Muse Batch Manager thành công',
                    timestamp: new Date().toISOString()
                }
            }));
        }
        catch (err) {
            console.error('[WebSocket] Error sending welcome message:', err);
        }
        ws.on('error', (err) => {
            console.error('[WebSocket] Client error:', err);
        });
    });
    return wss;
}
function broadcast(type, payload) {
    if (!wss)
        return;
    const message = JSON.stringify({ type, payload });
    wss.clients.forEach((client) => {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            try {
                client.send(message);
            }
            catch (err) {
                console.error('[WebSocket] Broadcast error:', err);
            }
        }
    });
}
function getWss() {
    return wss;
}
