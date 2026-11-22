require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('Configura JWT_SECRET con al menos 32 caracteres en .env');
const db = new Database(process.env.DB_FILE || './zona-cero.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 xp INTEGER NOT NULL DEFAULT 0,
 rank TEXT NOT NULL DEFAULT 'Recluta',
 wins INTEGER NOT NULL DEFAULT 0,
 losses INTEGER NOT NULL DEFAULT 0
);
`);

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || '*';
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(s => s.trim()) }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

const io = new Server(server, {
 cors: { origin: allowedOrigin === '*' ? true : allowedOrigin.split(',').map(s => s.trim()), methods: ['GET','POST'] },
 transports: ['websocket', 'polling']
});
const rooms = new Map(); // roomCode -> Map(socketId -> public player state)
const MAX_PLAYERS = 30;
const cleanUser = row => ({ id: row.id, username: row.username, xp: row.xp, rank: row.rank, wins: row.wins, losses: row.losses });
const sign = row => jwt.sign({ sub: row.id, username: row.username }, JWT_SECRET, { expiresIn: '14d' });
function authHeader(req) {
 const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
 return token ? jwt.verify(token, JWT_SECRET) : null;
}
function validUsername(v) { return typeof v === 'string' && /^[a-zA-Z0-9_]{3,18}$/.test(v); }

app.get('/health', (_req, res) => res.json({ ok: true, service: 'zona-cero-online', rooms: rooms.size }));
app.post('/api/register', async (req, res) => {
 const { username, password } = req.body || {};
 if (!validUsername(username)) return res.status(400).json({ error: 'El usuario debe tener 3-18 caracteres: letras, números o _.' });
 if (typeof password !== 'string' || password.length < 10 || password.length > 72) return res.status(400).json({ error: 'La contraseña debe tener entre 10 y 72 caracteres.' });
 try {
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO users (username,password_hash) VALUES (?,?)').run(username, hash);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ token: sign(row), user: cleanUser(row) });
 } catch (e) {
  if (String(e.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'Ese nombre de usuario ya existe.' });
  res.status(500).json({ error: 'No se pudo crear la cuenta.' });
 }
});
app.post('/api/login', async (req, res) => {
 const { username, password } = req.body || {};
 if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Completa usuario y contraseña.' });
 const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
 if (!row || !(await bcrypt.compare(password, row.password_hash))) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
 res.json({ token: sign(row), user: cleanUser(row) });
});
app.get('/api/me', (req, res) => {
 try { const claims = authHeader(req); if (!claims) return res.status(401).json({ error: 'Inicia sesión.' });
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(claims.sub);
  if (!row) return res.status(401).json({ error: 'Cuenta no encontrada.' });
  res.json({ user: cleanUser(row) });
 } catch { res.status(401).json({ error: 'Sesión no válida.' }); }
});
app.put('/api/progress', (req, res) => {
 try {
  const claims = authHeader(req); if (!claims) return res.status(401).json({ error: 'Inicia sesión.' });
  const { xp, rank, wins, losses } = req.body || {};
  if (!Number.isInteger(xp) || xp < 0 || xp > 100000000 || !['Recluta','Bronce','Plata','Oro','Élite','Leyenda'].includes(rank) || !Number.isInteger(wins) || wins < 0 || wins > 1000000 || !Number.isInteger(losses) || losses < 0 || losses > 1000000) return res.status(400).json({ error: 'Progreso no válido.' });
  // Este endpoint es una base inicial: en producción, XP y resultados deben calcularse y validarse en el servidor de partida.
  db.prepare('UPDATE users SET xp=?,rank=?,wins=?,losses=? WHERE id=?').run(xp, rank, wins, losses, claims.sub);
  res.json({ ok: true });
 } catch { res.status(401).json({ error: 'Sesión no válida.' }); }
});

io.use((socket, next) => {
 try {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('AUTH_REQUIRED'));
  const claims = jwt.verify(token, JWT_SECRET);
  const row = db.prepare('SELECT id,username FROM users WHERE id=?').get(claims.sub);
  if (!row) return next(new Error('AUTH_INVALID'));
  socket.user = { id: row.id, username: row.username };
  next();
 } catch { next(new Error('AUTH_INVALID')); }
});
function publicRoom(code) {
 const members = rooms.get(code);
 return { code, count: members?.size || 0, capacity: MAX_PLAYERS, players: [...(members?.values() || [])] };
}
function leaveRoom(socket) {
 const code = socket.data.roomCode;
 if (!code) return;
 const members = rooms.get(code);
 if (members) {
  members.delete(socket.id);
  socket.to(code).emit('room:player-left', { socketId: socket.id, username: socket.user.username });
  if (!members.size) rooms.delete(code);
  else io.to(code).emit('room:state', publicRoom(code));
 }
 socket.leave(code); socket.data.roomCode = null;
}
io.on('connection', socket => {
 socket.emit('session:ready', { user: socket.user });
 socket.on('room:create', (opts = {}, ack = () => {}) => {
  leaveRoom(socket);
  let code; do { code = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (rooms.has(code));
  rooms.set(code, new Map());
  join(code);
  function join(c) { const members = rooms.get(c); members.set(socket.id, { socketId: socket.id, userId: socket.user.id, username: socket.user.username, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, ready: false }); socket.join(c); socket.data.roomCode = c; }
  ack({ ok: true, room: publicRoom(code) }); io.to(code).emit('room:state', publicRoom(code));
 });
 socket.on('room:join', ({ code } = {}, ack = () => {}) => {
  code = typeof code === 'string' ? code.trim().toUpperCase() : '';
  const members = rooms.get(code);
  if (!members) return ack({ ok: false, error: 'Sala no encontrada.' });
  if (members.size >= MAX_PLAYERS) return ack({ ok: false, error: 'La sala está llena (30 jugadores).' });
  if (socket.data.roomCode === code) return ack({ ok: true, room: publicRoom(code) });
  leaveRoom(socket);
  members.set(socket.id, { socketId: socket.id, userId: socket.user.id, username: socket.user.username, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, ready: false });
  socket.join(code); socket.data.roomCode = code;
  ack({ ok: true, room: publicRoom(code) }); io.to(code).emit('room:state', publicRoom(code));
 });
 socket.on('player:state', state => {
  const code = socket.data.roomCode, members = rooms.get(code); if (!members || !state || typeof state !== 'object') return;
  const n = v => Number.isFinite(v) ? Math.max(-10000, Math.min(10000, v)) : 0;
  const clean = { x:n(state.x), y:n(state.y), z:n(state.z), yaw:n(state.yaw), pitch:n(state.pitch) };
  const me = members.get(socket.id); if (!me) return;
  Object.assign(me, clean);
  socket.to(code).volatile.emit('player:state', { socketId: socket.id, ...clean });
 });
 socket.on('room:leave', () => leaveRoom(socket));
 socket.on('disconnect', () => leaveRoom(socket));
});
server.listen(PORT, () => console.log(`ZONA CERO online escuchando en :${PORT}`));
