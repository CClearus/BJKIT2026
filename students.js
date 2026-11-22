// Student logins.
//
// data/students.json is the roster: one entry per student.
//   { "username": "1", "name": "ธีรภัทร นนท์นภาพันธ์", "grade": "M.4", "clan": "bandhu-ratchasi", "password": "123456" }
// To set or reset a password, write it as "password" (plain text) and restart the server:
// it is then replaced by a scrypt "passwordHash", so the file never keeps readable passwords.
//
// data/sessions.json holds who is logged in (a random token per login, kept in an HttpOnly cookie).
// One login per student: logging in again somewhere else ends the older login.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'sid';
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

let ROSTER_FILE, SESSION_FILE;
let roster = [];            // [{ username, name, grade, clan, passwordHash }]
let byUsername = new Map();
let sessions = {};          // token -> { u: username, exp: ms }

/* ---------- passwords ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), want.length);
  return crypto.timingSafeEqual(got, want);
}
// Same time whether or not the username exists, so a wrong username isn't faster than a wrong password.
const DUMMY_HASH = hashPassword(crypto.randomBytes(8).toString('hex'));

/* ---------- roster ---------- */
const cleanUsername = (u) => String(u ?? '').trim().toLowerCase();

function load(dataDir, clanIds) {
  ROSTER_FILE = path.join(dataDir, 'students.json');
  SESSION_FILE = path.join(dataDir, 'sessions.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('Could not read data/students.json:', e.message); }
  if (!Array.isArray(list)) list = [];

  let changed = false;
  roster = [];
  byUsername = new Map();
  for (const s of list) {
    const username = cleanUsername(s && s.username);
    if (!username) continue;
    if (byUsername.has(username)) { console.warn(`students.json: username "${username}" is used twice; only the first one can log in.`); continue; }
    if (s.clan && clanIds && !clanIds.has(s.clan)) console.warn(`students.json: ${username} has an unknown clan "${s.clan}".`);
    if (s.password != null && s.password !== '') {        // plain password written by the admin: hash it now
      s.passwordHash = hashPassword(s.password);
      delete s.password;
      changed = true;
    }
    const st = { username, name: String(s.name || username), grade: String(s.grade || ''), clan: s.clan || null, passwordHash: s.passwordHash || '' };
    roster.push(st);
    byUsername.set(username, st);
  }
  if (changed) {
    fs.writeFileSync(ROSTER_FILE, JSON.stringify(list, null, 2));
    console.log('students.json: new passwords were hashed.');
  }

  try { sessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) || {}; } catch { sessions = {}; }
  const now = Date.now();
  for (const [t, s] of Object.entries(sessions)) if (!s || s.exp < now || !byUsername.has(s.u)) delete sessions[t];
  return roster.length;
}

let saveTimer = null;
function saveSessions() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fsp.writeFile(SESSION_FILE + '.tmp', JSON.stringify(sessions));
      await fsp.rename(SESSION_FILE + '.tmp', SESSION_FILE);
    } catch (e) { console.error('Could not save sessions:', e.message); }
  }, 300);
}

/* ---------- sessions ---------- */
function tokenOf(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function userOf(req) {
  const t = tokenOf(req);
  const s = t && sessions[t];
  if (!s) return null;
  if (s.exp < Date.now()) { delete sessions[t]; saveSessions(); return null; }
  return byUsername.get(s.u) || null;
}
const publicUser = (u) => (u ? { username: u.username, name: u.name, grade: u.grade, clan: u.clan } : null);

// Returns { user, cookie } or null.
function login(username, password) {
  const u = byUsername.get(cleanUsername(username));
  const ok = checkPassword(password, u ? u.passwordHash : DUMMY_HASH);
  if (!u || !ok) return null;
  for (const [t, s] of Object.entries(sessions)) if (s.u === u.username) delete sessions[t];   // newest login wins
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { u: u.username, exp: Date.now() + SESSION_MS };
  saveSessions();
  return { user: u, cookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}` };
}
function logout(req) {
  const t = tokenOf(req);
  if (t && sessions[t]) { delete sessions[t]; saveSessions(); }
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ---------- too many wrong passwords ---------- */
// 10 wrong tries from one computer within 5 minutes: wait 1 minute.
const fails = new Map();   // ip -> { n, first, until }
function blockedFor(ip) {
  const f = fails.get(ip);
  if (!f) return 0;
  if (f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 1000);
  if (Date.now() - f.first > 5 * 60 * 1000) fails.delete(ip);
  return 0;
}
function noteFail(ip) {
  const now = Date.now();
  let f = fails.get(ip);
  if (!f || now - f.first > 5 * 60 * 1000) f = { n: 0, first: now, until: 0 };
  f.n++;
  if (f.n >= 10) { f.until = now + 60 * 1000; f.n = 0; f.first = now; }
  fails.set(ip, f);
}
const noteOk = (ip) => fails.delete(ip);

// For the admin: who is in each clan.
const membersByClan = () => {
  const out = {};
  for (const s of roster) if (s.clan) (out[s.clan] ||= []).push({ username: s.username, name: s.name, grade: s.grade });
  return out;
};

module.exports = { load, userOf, publicUser, login, logout, blockedFor, noteFail, noteOk, membersByClan, count: () => roster.length };
