// Clans (the six teams of the camp). Everything here is shared by the whole clan:
// cleared missions, best test progress, score, hints and the code being written.
//
// Which clan a request belongs to is decided in ONE place: clanOf(req).
// For now the browser says it in the X-Clan header (set by the admin's "Play as" button).
// Later the player roster (spreadsheet / Supabase) will decide it there instead.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const CLANS = [
  { id: 'erawan', no: 1, name: 'Erawan', thai: 'เอราวัณ', color: '#8E86BE' },
  { id: 'mayurawentai', no: 2, name: 'Mayurawentai', thai: 'มยุรเวนไตย', color: '#7DD0DC' },
  { id: 'nakkharat', no: 3, name: 'Nakkharat', thai: 'นาคราช', color: '#8ED1BC' },
  { id: 'bandhu-ratchasi', no: 4, name: 'Bandhu Ratchasi', thai: 'บัณฑุราชสีห์', color: '#F7CB7A' },
  { id: 'kilen', no: 5, name: 'Kilen', thai: 'กิเลน', color: '#E58873' },
  { id: 'khrutha', no: 6, name: 'Khrutha', thai: 'ครุฑา', color: '#E5675A' },
];
const CLAN_IDS = new Set(CLANS.map((c) => c.id));

// Points for clearing a mission (never shown per mission, only the clan's total).
// Special missions: the first clan to clear one gets SPECIAL_FIRST, every later clan SPECIAL_LATER.
const POINTS = { 1: 5, 2: 20, 3: 30, 4: 60, 5: 120, 6: 200 };
const SPECIAL_FIRST = 50;
const SPECIAL_LATER = 20;
const HINTS_PER_CLAN = 3;
const CODE_SLOTS = ['p1', 'p2', 'c'];   // co-op: Player 1 / Player 2 boxes; solo: the one box

let STATE_FILE, CODE_FILE;
let state = {};   // clanId -> { solved: {pid: iso}, progress: {pid: {passed, total}}, hintsUsed, revealed: {"pid:scope": iso} }
let code = {};    // clanId -> { pid -> { slot -> { code, v } } }

const blank = () => ({ solved: {}, progress: {}, hintsUsed: 0, revealed: {} });
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

// The one place that decides who a request plays for.
function clanOf(req) {
  const id = String(req.headers['x-clan'] || '').trim().toLowerCase();
  return CLAN_IDS.has(id) ? id : null;
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
    if (!s.solved[p.id]) continue;
    if (p.difficulty === 'special') total += firsts[p.id] === id ? SPECIAL_FIRST : SPECIAL_LATER;
    else total += POINTS[p.difficulty] || 0;
  }
  return total;
}

/* ---------- submit ---------- */
// Keeps the best progress and the FIRST time the clan cleared the mission.
function recordSubmit(id, pid, passed, total, accepted) {
  const s = clanState(id);
  const best = s.progress[pid];
  if (!best || !best.total || passed / total >= best.passed / best.total) s.progress[pid] = { passed, total };
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

/* ---------- what a clan member's browser needs ---------- */
function stateFor(id, problems) {
  const firsts = firstClears(problems);
  if (!id) return { clan: null, firsts };
  const s = clanState(id);
  const ids = new Set(problems.map((p) => p.id));
  return {
    clan: id,
    score: scoreOf(id, problems, firsts),
    solved: Object.keys(s.solved).filter((pid) => ids.has(pid)),
    progress: s.progress,
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
        cleared: Object.keys(s.solved).filter((pid) => ids.has(pid)).length,
        hintsLeft: Math.max(0, HINTS_PER_CLAN - (s.hintsUsed || 0)),
        firsts: Object.keys(firsts).filter((pid) => firsts[pid] === c.id),
      };
    }),
    missions: problems.length,
  };
}
function reset(id) {
  state[id] = blank();
  delete code[id];
  persist('state');
  persist('code');
}

module.exports = {
  CLANS, CODE_SLOTS, load, clanOf, recordSubmit, useHint, hintsLeft, getCode, putCode, stateFor, overview, reset,
};
