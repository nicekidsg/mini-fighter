'use strict';
/* 小斗士 联机服务器：静态托管 public/ + WebSocket 房间转发（每房最多4人） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  const fp = path.join(PUB, path.normalize(file));
  if (!fp.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // room -> Map<ws, {slot, name}>

function broadcast(room, msg, except) {
  const members = rooms.get(room);
  if (!members) return;
  const data = JSON.stringify(msg);
  for (const ws of members.keys()) {
    if (ws !== except && ws.readyState === 1) ws.send(data);
  }
}

wss.on('connection', ws => {
  ws.room = null;
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join' && !ws.room) {
      const room = String(m.room).slice(0, 12);
      const name = String(m.name || '无名氏').slice(0, 8);
      const ch = Math.max(0, Math.min(9, m.ch | 0));   // 所选角色编号
      let members = rooms.get(room);
      if (!members) { members = new Map(); rooms.set(room, members); }
      const used = new Set([...members.values()].map(v => v.slot));
      let slot = -1;
      for (let i = 0; i < 4; i++) if (!used.has(i)) { slot = i; break; }
      if (slot === -1) { ws.send(JSON.stringify({ t: 'full' })); return; }
      ws.room = room; ws.slot = slot; ws.name = name;
      members.set(ws, { slot, name, ch });
      ws.send(JSON.stringify({
        t: 'joined', slot,
        peers: [...members.values()].filter(v => v.slot !== slot),
      }));
      broadcast(room, { t: 'peer', slot, name, ch }, ws);
      console.log(`[${room}] ${name} 加入 (slot ${slot})，当前 ${members.size} 人`);
      return;
    }

    // 其余消息：附上来源 slot 后在房间内转发
    if (ws.room) {
      m.f = ws.slot;
      broadcast(ws.room, m, ws);
    }
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const members = rooms.get(ws.room);
    if (members) {
      members.delete(ws);
      broadcast(ws.room, { t: 'left', slot: ws.slot });
      if (members.size === 0) rooms.delete(ws.room);
      console.log(`[${ws.room}] ${ws.name} 离开，剩余 ${members.size} 人`);
    }
  });
});

server.listen(PORT, () => console.log(`小斗士已启动：http://localhost:${PORT}`));
