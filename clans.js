// Clans (the six teams of the camp). Everything here is shared by the whole clan:
// cleared missions, best test progress, score, hints and the code being written.
//
// Which clan a request belongs to is decided in ONE place: clanOf(req),
// from the logged-in student (students.js, roster in data/students.json).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const students = require('./students');

const CLANS = [
  { id: 'erawan', no: 1, name: 'Erawan', thai: 'เอราวัณ', color: '#8E86BE' },
  { id: 'mayurawentai', no: 2, name: 'Mayurawentai', thai: 'มยุรเวนไตย', color: '#7DD0DC' },
  { id: 'nakkharat', no: 3, name: 'Nakkharat', thai: 'นาคราช', color: '#8ED1BC' },
  { id: 'bandhu-ratchasi', no: 4, name: 'Bandhu Ratchasi', thai: 'บัณฑุราชสีห์', color: '#F7CB7A' },
  { id: 'kilen', no: 5, name: 'Kilen', thai: 'กิเลน', color: '#E58873' },
  { id: 'khrutha', no: 6, name: 'Khrutha', thai: 'ครุฑา', color: '#E5675A' },
];
const CLAN_IDS = new Set(CLANS.map((c) => c.id));

// Points for a mission (never shown per mission, only the clan's total).
// Normal missions: points × the share of hidden tests passed in the clan's best Submit, rounded down
// (every test counts the same: team tests and each player's own tests). 100% = full points + cleared.
// Special missions are all-or-nothing: the first clan to clear one gets SPECIAL_FIRST, every later clan SPECIAL_LATER.
const POINTS = { 0: 0, 1: 5, 2: 20, 3: 30, 4: 60, 5: 120, 6: 200 };   // level 0 = example missions, no points
const SPECIAL_FIRST = 50;
const SPECIAL_LATER = 20;
const HINTS_PER_CLAN = 3;
const CODE_SLOTS = ['p1', 'p2', 'c'];   // co-op: Player 1 / Player 2 boxes; solo: the one box

let STATE_FILE, CODE_FILE;
// clanId -> { solved: {pid: iso}, progress: {pid: {passed, total}}, suites: {pid: {team|p1|p2: {passed, total}}},
//             hintsUsed, revealed: {"pid:scope": iso} }
// progress is the best whole Submit; suites keeps each test set's own best (once full, it stays full).
let state = {};
let code = {};    // clanId -> { pid -> { slot -> { code, v } } }

const blank = () => ({ solved: {}, progress: {}, suites: {}, hintsUsed: 0, revealed: {} });
const clanState = (id) => (state[id] ||= blank());

function load(dataDir) {
  STATE_FILE = path.join(dataDir, 'clans.json');
  CODE_FILE = path.join(dataDir, 'clan-code.json');
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch { state = {}; }
  try { code = JSON.parse(fs.readFileSync(CODE_FILE, 'utf8')) || {}; } catch { code = {}; }
}

// Writes are batched: many players type at once, so save at most every 400 ms.
const timers = {};
let writing = Promise.resolve();
function persist(which) {
  if (timers[which]) return;
  timers[which] = setTimeout(() => {
    timers[which] = null;
    const file = which === 'code' ? CODE_FILE : STATE_FILE;
    const data = JSON.stringify(which === 'code' ? code : state);
    writing = writing.then(async () => {
      await fsp.writeFile(file + '.tmp', data);
      await fsp.rename(file + '.tmp', file);
    }).catch((e) => console.error('Could not save clans:', e));
  }, 400);
}

// The one place that decides who a request plays for: the logged-in student's clan (data/students.json).
function clanOf(req) {
  const u = students.userOf(req);
  return u && CLAN_IDS.has(u.clan) ? u.clan : null;
}

/* ---------- score ---------- */
// Special missions: which clan cleared each one first.
function firstClears(problems) {
  const out = {};
  for (const p of problems) {
    if (p.difficulty !== 'special') continue;
    let best = null;
    for (const c of CLANS) {
      const at = state[c.id] && state[c.id].solved[p.id];
      if (at && (!best || at < best.at)) best = { id: c.id, at };
    }
    if (best) out[p.id] = best.id;
  }
  return out;
}
function scoreOf(id, problems, firsts = firstClears(problems)) {
  const s = state[id];
  if (!s) return 0;
  let total = 0;
  for (const p of problems) {
    if (p.difficulty === 'special') {
      if (s.solved[p.id]) total += firsts[p.id] === id ? SPECIAL_FIRST : SPECIAL_LATER;
      continue;
    }
    const pts = POINTS[p.difficulty] || 0;
    const best = s.progress[p.id];
    if (s.solved[p.id]) total += pts;
    // multiply first, then divide: whole numbers, so 29% of 100 is 29 (not 28.999…)
    else if (best && best.total > 0) total += Math.floor((pts * best.passed) / best.total);
  }
  return total;
}
// Money: every point the clan earns is also 1 money, plus whatever the admin adds or takes away by
// hand (moneyAdjust). Never below 0. Nothing can be bought with it yet.
function moneyOf(id, problems, firsts) {
  const s = state[id];
  return Math.max(0, scoreOf(id, problems, firsts) + ((s && s.moneyAdjust) || 0));
}
// Admin: add (or, with a negative amount, take away) money. Returns the new amount.
function addMoney(id, amount, problems) {
  const s = clanState(id);
  const before = moneyOf(id, problems);
  const delta = Math.max(-before, Math.round(Number(amount) || 0));   // can't go below 0
  s.moneyAdjust = (s.moneyAdjust || 0) + delta;
  persist('state');
  return moneyOf(id, problems);
}
const better = (a, b) => !b || !b.total || a.passed / a.total >= b.passed / b.total;

/* ---------- submit ---------- */
// Keeps the best progress, each test set's best (sets = { team, p1, p2 } -> { passed, total })
// and the FIRST time the clan cleared the mission.
function recordSubmit(id, pid, passed, total, accepted, sets = {}) {
  const s = clanState(id);
  if (total > 0 && better({ passed, total }, s.progress[pid])) s.progress[pid] = { passed, total };
  const mine = ((s.suites ||= {})[pid] ||= {});
  for (const [suite, r] of Object.entries(sets)) {
    if (r && r.total > 0 && better(r, mine[suite])) mine[suite] = { passed: r.passed, total: r.total };
  }
  if (accepted && !s.solved[pid]) s.solved[pid] = new Date().toISOString();
  persist('state');
}

/* ---------- hints: one pool per clan; a revealed hint is open to the whole clan ---------- */
const hintKey = (pid, scope) => `${pid}:${scope}`;
const hintsLeft = (id) => Math.max(0, HINTS_PER_CLAN - (clanState(id).hintsUsed || 0));
// Returns true when the clan may see this hint (already revealed, or a hint was spent on it now).
function useHint(id, pid, scope) {
  const s = clanState(id);
  if (s.revealed[hintKey(pid, scope)]) return true;
  if (hintsLeft(id) <= 0) return false;
  s.hintsUsed = (s.hintsUsed || 0) + 1;
  s.revealed[hintKey(pid, scope)] = new Date().toISOString();
  persist('state');
  return true;
}

/* ---------- shared code: last save wins, per box ---------- */
function getCode(id, pid) {
  return (code[id] && code[id][pid]) || {};
}
function putCode(id, pid, slot, text) {
  const forClan = (code[id] ||= {});
  const forProblem = (forClan[pid] ||= {});
  const v = Math.max(Date.now(), ((forProblem[slot] && forProblem[slot].v) || 0) + 1);
  forProblem[slot] = { code: text, v };
  persist('code');
  return v;
}

/* ---------- co-op parts: who in the clan is Player 1 / Player 2 of each problem ---------- */
// state[clan].roles[pid] = { p1: { u: username, name }, p2: { ... } }  (saved)
// lastSeen: when the part's owner last had the problem open (memory only; their page checks in every 2 s).
// A part whose owner has been away for AWAY_MS can be freed by a teammate (its code is kept).
const PARTS = ['p1', 'p2'];
const AWAY_MS = Number(process.env.PART_AWAY_MS) || 5 * 60 * 1000;   // (PART_AWAY_MS only for testing)
const lastSeen = new Map();   // "clan:pid:part" -> ms
const startedAt = Date.now();
const seenKey = (id, pid, part) => `${id}:${pid}:${part}`;
const rolesOf = (id, pid) => ((clanState(id).roles ||= {})[pid] ||= {});

function roleOf(id, pid, username) {
  const r = state[id] && state[id].roles && state[id].roles[pid];
  if (!r) return null;
  return PARTS.find((p) => r[p] && r[p].u === username) || null;
}
// What the page shows: { p1: { username, name, away, awayMin } | null, p2: ... }
function rolesFor(id, pid) {
  const r = (state[id] && state[id].roles && state[id].roles[pid]) || {};
  const out = {};
  for (const p of PARTS) {
    if (!r[p]) { out[p] = null; continue; }
    const idle = Date.now() - (lastSeen.get(seenKey(id, pid, p)) || startedAt);
    out[p] = { username: r[p].u, name: r[p].name, away: idle >= AWAY_MS, awayMin: Math.floor(idle / 60000) };
  }
  return out;
}
// The owner's page checked in.
function touchRole(id, pid, username) {
  const part = roleOf(id, pid, username);
  if (part) lastSeen.set(seenKey(id, pid, part), Date.now());
}
// Giving up a part wipes its code back to the starter, for the whole clan.
function wipePart(id, pid, part, starter) {
  putCode(id, pid, part, starter);
}
// Take a free part. Taking the other part gives up (and wipes) the one you had.
// Returns null, or an error message.
function takeRole(id, pid, user, part, starters) {
  if (!PARTS.includes(part)) return 'Unknown part.';
  const r = rolesOf(id, pid);
  if (r[part] && r[part].u !== user.username) return `${part === 'p1' ? 'Player 1' : 'Player 2'} is already taken by ${r[part].name}.`;
  const had = roleOf(id, pid, user.username);
  if (had === part) return null;
  if (had) { delete r[had]; wipePart(id, pid, had, starters[had]); }
  r[part] = { u: user.username, name: user.name };
  lastSeen.set(seenKey(id, pid, part), Date.now());
  persist('state');
  return null;
}
function leaveRole(id, pid, user, starters) {
  const had = roleOf(id, pid, user.username);
  if (!had) return 'You have no part on this problem.';
  delete rolesOf(id, pid)[had];
  wipePart(id, pid, had, starters[had]);
  persist('state');
  return null;
}
// A teammate frees a part whose owner has been away for 5 minutes. The code stays for whoever takes it next.
function freeRole(id, pid, part) {
  const r = rolesOf(id, pid);
  if (!r[part]) return null;
  const idle = Date.now() - (lastSeen.get(seenKey(id, pid, part)) || startedAt);
  if (idle < AWAY_MS) return `${r[part].name} is still working on this part.`;
  delete r[part];
  persist('state');
  return null;
}

/* ---------- what a clan member's browser needs ---------- */
function stateFor(id, problems) {
  const firsts = firstClears(problems);
  if (!id) return { clan: null, firsts };
  const s = clanState(id);
  const ids = new Set(problems.map((p) => p.id));
  return {
    clan: id,
    score: scoreOf(id, problems, firsts),
    money: moneyOf(id, problems, firsts),
    solved: Object.keys(s.solved).filter((pid) => ids.has(pid)),
    progress: s.progress,
    suites: s.suites || {},
    resetAt: s.resetAt || 0,
    started: Object.keys(code[id] || {}).filter((pid) => ids.has(pid)),
    hintsLeft: hintsLeft(id),
    revealed: Object.keys(s.revealed),
    firsts,
  };
}

/* ---------- admin ---------- */
function overview(problems) {
  const firsts = firstClears(problems);
  const ids = new Set(problems.map((p) => p.id));
  return {
    points: { ...POINTS, specialFirst: SPECIAL_FIRST, specialLater: SPECIAL_LATER },
    hintsPerClan: HINTS_PER_CLAN,
    clans: CLANS.map((c) => {
      const s = state[c.id] || blank();
      return {
        ...c,
        score: scoreOf(c.id, problems, firsts),
        money: moneyOf(c.id, problems, firsts),
        cleared: Object.keys(s.solved).filter((pid) => ids.has(pid)).length,
        hintsLeft: Math.max(0, HINTS_PER_CLAN - (s.hintsUsed || 0)),
        firsts: Object.keys(firsts).filter((pid) => firsts[pid] === c.id),
      };
    }),
    missions: problems.length,
  };
}
// resetAt tells the students' browsers that a reset happened, so they drop their own saved copy of
// the code too (otherwise the editor would send it straight back to the server).
function reset(id) {
  state[id] = { ...blank(), resetAt: Date.now() };
  delete code[id];
  persist('state');
  persist('code');
}
// Every clan back to the start: cleared missions, scores, hints and all saved code.
function resetAll() {
  const now = Date.now();
  state = {};
  for (const c of CLANS) state[c.id] = { ...blank(), resetAt: now };
  code = {};
  persist('state');
  persist('code');
}
const resetAtOf = (id) => (state[id] && state[id].resetAt) || 0;

module.exports = {
  CLANS, CODE_SLOTS, load, clanOf, recordSubmit, useHint, hintsLeft, getCode, putCode, stateFor, overview, reset, resetAll, resetAtOf, addMoney,
  roleOf, rolesFor, touchRole, takeRole, leaveRole, freeRole,
};
