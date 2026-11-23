// Online C/C++ practice site.
// - Serves the website in ./public
// - Stores each problem in its own file ./data/problems/<id>.json and images in ./data/uploads
// - Compiles submitted code with GCC from ./gcc/mingw64/bin (installed by setup-gcc.bat),
//   or from the system PATH (e.g. a Linux server with build-essential).
// No npm packages needed: run with `node server.js`.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const clans = require('./clans');
const OutputMatch = require('./public/js/output-match.js');   // same checker the pages use
const students = require('./students');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PROBLEMS_DIR = path.join(DATA_DIR, 'problems');            // one <id>.json per problem
const OLD_PROBLEMS_FILE = path.join(DATA_DIR, 'problems.json');  // old single-file store, migrated on start
const TESTS_DIR = path.join(DATA_DIR, 'tests');
const ADMIN_FILE = path.join(DATA_DIR, 'admin-password.txt');
const GIF_DIR = path.join(DATA_DIR, 'gif');   // loading-screen GIFs: drop more in, no restart needed
const IS_WIN = process.platform === 'win32';
const LOCAL_GCC_BIN = path.join(__dirname, 'gcc', 'mingw64', 'bin');

const LIMITS = {
  maxCodeBytes: 100 * 1024,
  maxStdinBytes: 1024 * 1024,
  maxInputsPerRun: 20,
  compileTimeoutMs: 15000,
  defaultRunTimeoutMs: 2000,
  maxRunTimeoutMs: 10000,
  maxOutputBytes: 64 * 1024,
  maxConcurrentJobs: 2,
  maxProblemBytes: 4 * 1024 * 1024,
  maxUploadBytes: 5 * 1024 * 1024,
  maxVideoBytes: 100 * 1024 * 1024,
  maxTests: 100,
  maxTestsBytes: 64 * 1024 * 1024,   // all test cases of one problem together
  maxJudgeMs: 90000,                 // stop judging after this; remaining tests are skipped
  maxJudgeOutputBytes: 32 * 1024 * 1024,
};

// C only (C++ is turned off).
const LANGS = {
  c:   { compiler: 'gcc', ext: '.c',   flags: ['-std=c11', '-O2', '-Wall', '-static'], libs: ['-lm'] },
};

// =============== admin password ===============

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(TESTS_DIR, { recursive: true });
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
  || (fs.existsSync(ADMIN_FILE) ? fs.readFileSync(ADMIN_FILE, 'utf8').trim() : '');
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(ADMIN_FILE, ADMIN_PASSWORD + '\n');
}

function isAdmin(req) {
  const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

// =============== problems store ===============

const SEED_PROBLEM = {
  id: 'sum-of-numbers',
  number: '1',
  name: 'Sum of Numbers',
  difficulty: '1',
  timeLimit: 1,
  memoryLimit: 256,
  statement: '<p>You are given $N$ integers $a_1, a_2, \\ldots, a_N$. Find their sum.</p><p>The answer can be larger than a 32-bit integer, so use <code>long long</code>.</p>',
  input: '<p>The first line contains one integer $N$.</p><p>The second line contains $N$ integers $a_1, a_2, \\ldots, a_N$, separated by spaces.</p>',
  output: '<p>Print one integer: $a_1 + a_2 + \\cdots + a_N$.</p>',
  constraints: '<ul><li>$1 \\le N \\le 10^5$</li><li>$-10^9 \\le a_i \\le 10^9$</li></ul>',
  samples: [
    { input: '3\n10 20 30\n', output: '60\n' },
    { input: '5\n-1 2 -3 4 -5\n', output: '-3\n' },
  ],
};

// Difficulty levels: '0' (example missions, no points), '1'..'5' stars, '6' (purple), 'special'.
// Old easy/medium/hard are converted.
const LEVELS = ['0', '1', '2', '3', '4', '5', '6', 'special'];
function normalizeLevel(d) {
  const s = String(d ?? '').toLowerCase();
  if (LEVELS.includes(s)) return s;
  return { easy: '1', medium: '3', hard: '5' }[s] || '1';
}
const levelOrder = (l) => LEVELS.indexOf(normalizeLevel(l));

// Each problem is its own file: data/problems/<id>.json. Files can be added, edited or removed
// by hand while the server is stopped (the file name must match the problem's "id").
const ID_RE = /^[\w-]+$/;
const problemFile = (id) => path.join(PROBLEMS_DIR, `${id}.json`);

let problems = [];
function loadProblems() {
  fs.mkdirSync(PROBLEMS_DIR, { recursive: true });
  problems = [];
  for (const name of fs.readdirSync(PROBLEMS_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      // (some Windows editors put an invisible BOM at the start of the file: skip it)
      const p = JSON.parse(fs.readFileSync(path.join(PROBLEMS_DIR, name), 'utf8').replace(/^﻿/, ''));
      p.id = name.slice(0, -5);   // the file name is the id
      if (ID_RE.test(p.id)) problems.push(p);
      else console.warn(`Skipped problem file ${name}: use only letters, digits, _ and - in the name.`);
    } catch (e) {
      console.warn(`Skipped problem file ${name}: ${e.message}`);
    }
  }

  // One-time move from the old data/problems.json (kept as problems.json.bak).
  if (fs.existsSync(OLD_PROBLEMS_FILE)) {
    try {
      const old = JSON.parse(fs.readFileSync(OLD_PROBLEMS_FILE, 'utf8'));
      for (const p of Array.isArray(old) ? old : []) {
        if (!p || !ID_RE.test(String(p.id)) || problems.some((x) => x.id === p.id)) continue;
        problems.push(p);
        saveProblem(p);
      }
      fs.renameSync(OLD_PROBLEMS_FILE, OLD_PROBLEMS_FILE + '.bak');
      console.log(`Moved problems into ${PROBLEMS_DIR} (old file kept as problems.json.bak).`);
    } catch (e) {
      console.error('Could not move the old problems.json:', e.message);
    }
  }

  for (const p of problems) {
    let migrated = false;
    const lv = normalizeLevel(p.difficulty);
    if (lv !== p.difficulty) { p.difficulty = lv; migrated = true; }
    if (p.madeBy != null && !Array.isArray(p.madeBy)) { p.madeBy = p.madeBy ? [String(p.madeBy)] : []; migrated = true; }
    if ('publishedBy' in p) { delete p.publishedBy; migrated = true; }
    if ('paperLang' in p) { delete p.paperLang; migrated = true; }
    if (migrated) saveProblem(p);
  }

  if (!problems.length) {
    const now = new Date().toISOString();
    const seed = { ...SEED_PROBLEM, createdAt: now, updatedAt: now };
    problems = [seed];
    saveProblem(seed);
  }
}

// Writes are queued per problem so two quick saves of the same problem never interleave.
const saving = new Map();
function queueWrite(id, job) {
  const next = (saving.get(id) || Promise.resolve()).then(job)
    .catch((e) => console.error(`Could not save problem ${id}:`, e));
  saving.set(id, next);
  next.finally(() => { if (saving.get(id) === next) saving.delete(id); });
  return next;
}
function saveProblem(p) {
  const data = JSON.stringify(p, null, 2);
  return queueWrite(p.id, async () => {
    const file = problemFile(p.id), tmp = file + '.tmp';
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file);
  });
}
function removeProblemFile(id) {
  return queueWrite(id, () => fsp.rm(problemFile(id), { force: true }));
}
const byNumber = (a, b) => (levelOrder(a.difficulty) - levelOrder(b.difficulty))
  || String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
// Numbers restart in each level: Level 1 #1, Level 2 #1, ...
function numberTaken(p, exceptId) {
  return problems.some((x) => x.id !== exceptId && x.difficulty === p.difficulty
    && String(x.number).toLowerCase() === String(p.number).toLowerCase());
}
const levelName = (l) => (l === 'special' ? 'The ◆ Special level' : l === '0' ? 'The example level (0 stars)' : `The ${'★'.repeat(Number(l))} level`);
// Hints: 'global' (p.hint) for the whole problem; co-op problems also have one per player (p1Hint, p2Hint).
const HINT_FIELDS = { global: 'hint', p1: 'p1Hint', p2: 'p2Hint' };
const hasText = (html) => !!html && (html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '' || /<img|data-video=/i.test(html));
const hasHint = (p, scope = 'global') => hasText(p[HINT_FIELDS[scope]]);
const summary = (p) => ({ id: p.id, number: p.number, name: p.name, difficulty: p.difficulty, mode: p.mode === 'coop' ? 'coop' : 'solo' });

const playerSamples = (list) => (Array.isArray(list) ? list : []).slice(0, 20)
  .map((s) => ({ input: String((s && s.input) ?? '').slice(0, 1e5), output: String((s && s.output) ?? '').slice(0, 1e5) }));

// "Made by": [{ name, avatar }]. avatar is a picture uploaded through /api/upload, or ''.
// Older problems stored plain name strings; those still load and become { name, avatar: '' } on save.
const AVATAR_URL = /^uploads\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/;
function cleanAuthors(v) {
  return (Array.isArray(v) ? v : [v]).slice(0, 20).map((a) => {
    const o = a && typeof a === 'object' ? a : { name: a };
    const avatar = String(o.avatar || '');
    return { name: String(o.name ?? '').slice(0, 100).trim(), avatar: AVATAR_URL.test(avatar) ? avatar : '' };
  }).filter((a) => a.name);
}

function cleanProblem(body) {
  const str = (v, max) => String(v ?? '').slice(0, max);
  const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  const p = {
    number: str(body.number, 20).trim(),
    name: str(body.name, 200).trim(),
    difficulty: normalizeLevel(body.difficulty),
    madeBy: cleanAuthors(body.madeBy),
    timeLimit: num(body.timeLimit, 0.1, LIMITS.maxRunTimeoutMs / 1000, 1),
    memoryLimit: Math.round(num(body.memoryLimit, 1, 4096, 256)),
    statement: str(body.statement, 1e6),
    input: str(body.input, 2e5),
    output: str(body.output, 2e5),
    constraints: str(body.constraints, 2e5),
    hint: str(body.hint, 2e5),
    p1Hint: str(body.p1Hint, 2e5),
    p2Hint: str(body.p2Hint, 2e5),
    // Co-op: Player 1's code and Player 2's code form one continuous program.
    // (shared is no longer used; kept so older problems still load.)
    mode: body.mode === 'coop' ? 'coop' : 'solo',
    customScript: body.customScript === true,   // shows a script icon at the top right of the problem paper
    shared: str(body.shared, 50000),
    p1Task: str(body.p1Task, 2e5),
    p2Task: str(body.p2Task, 2e5),
    p1Starter: str(body.p1Starter, 50000),
    p2Starter: str(body.p2Starter, 50000),
    // Each player's own hidden tests are built from their file plus one of these helper files:
    //   Player 1 tests: p1.c + p1TestHelper (usually a test main() that calls Player 1's functions)
    //   Player 2 tests: p2TestHelper + p2.c (usually a reference version of Player 1's part)
    // Each player's objective on the problem sheet: explanation (p1Task/p2Task), output and examples
    p1Output: str(body.p1Output, 2e5),
    p2Output: str(body.p2Output, 2e5),
    p1Samples: playerSamples(body.p1Samples),
    p2Samples: playerSamples(body.p2Samples),
    p1TestHelper: str(body.p1TestHelper, 50000),
    p2TestHelper: str(body.p2TestHelper, 50000),
    // The admin's own finished code for each player's part. Never sent to players; the admin page
    // runs it against the hidden tests to check the setup and to fill in expected outputs.
    p1Solution: str(body.p1Solution, 50000),
    p2Solution: str(body.p2Solution, 50000),
    samples: (Array.isArray(body.samples) ? body.samples : []).slice(0, LIMITS.maxInputsPerRun)
      .map((s) => ({ input: str(s && s.input, 1e5), output: str(s && s.output, 1e5) })),
  };
  if (!p.name) throw new Error('The problem needs a name.');
  if (!p.number) throw new Error('The problem needs a number.');
  return p;
}

// Co-op starter code when a problem has none (same as the editor page's defaults).
// A part's code goes back to this when its player gives the part up.
const COOP_STARTERS = {
  p1: '#include <stdio.h>\n\nint main(void) {\n    // Player 1\n    \n',
  p2: '    // Player 2\n    \n    return 0;\n}\n',
};

// =============== camp timer (data/timer.json) ===============
// The admin sets a length, then starts, pauses and resumes it. Running: endsAt is when it hits 0.
// Paused or not started: remainingMs is what's left. durationMs 0 = no timer (nothing is locked).
// When it reaches 0, Submit is closed for students (Run still works).
const TIMER_FILE = path.join(DATA_DIR, 'timer.json');
let timer = { durationMs: 0, remainingMs: 0, endsAt: null };
try { timer = { ...timer, ...JSON.parse(fs.readFileSync(TIMER_FILE, 'utf8')) }; } catch {}
const saveTimer = () => fsp.writeFile(TIMER_FILE, JSON.stringify(timer)).catch((e) => console.error('Could not save the timer:', e));
const timeLeftMs = () => (timer.endsAt ? Math.max(0, timer.endsAt - Date.now()) : timer.remainingMs);
const timeIsUp = () => timer.durationMs > 0 && timeLeftMs() === 0;
function timerStatus() {
  const left = timeLeftMs();
  const status = !timer.durationMs ? 'off' : left === 0 ? 'ended' : timer.endsAt ? 'running'
    : left < timer.durationMs ? 'paused' : 'ready';
  // leftMs, not the end time: the browser counts down from its own clock, so a wrong PC clock doesn't matter
  return { status, leftMs: left, durationMs: timer.durationMs };
}

// =============== hidden test cases (data/tests/<problem id>.json) ===============

// Suites: 'team' (the whole program; also used for solo problems), 'p1' and 'p2' (each player's own part).
const SUITES = ['team', 'p1', 'p2'];
const testsFile = (id, suite = 'team') => path.join(TESTS_DIR, suite === 'team' ? `${id}.json` : `${id}.${suite}.json`);
async function readTests(id, suite = 'team') {
  try { return JSON.parse(await fsp.readFile(testsFile(id, suite), 'utf8')); } catch { return []; }
}
async function writeTests(id, tests, suite = 'team') {
  const file = testsFile(id, suite), tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(tests));
  await fsp.rename(tmp, file);
}
const testCounts = new Map();
async function testCount(id, suite = 'team') {
  const key = `${id}:${suite}`;
  if (!testCounts.has(key)) testCounts.set(key, (await readTests(id, suite)).length);
  return testCounts.get(key);
}
// Same comparison as most judges: ignore trailing spaces and trailing blank lines.
// "Custom script" problems also accept placeholders like {string} and {clan} (public/js/output-match.js).
// {clan} is the submitting student's clan; with no clan (e.g. not a student) any clan counts.
function clanNamesFor(clanId) {
  const list = clanId ? clans.CLANS.filter((c) => c.id === clanId) : clans.CLANS;
  return list.flatMap((c) => [c.name, c.thai]);
}

// Turn linker errors (the ones you get when two files don't fit together) into plain messages.
function tidyCompileOutput(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/undefined reference to [`'](\w+)'/))) {
      const file = (line.match(/([\w-]+\.c):\(/) || [])[1];
      out.push(`${file || 'linker'}: ${m[1]}() is used but never written (undefined reference to '${m[1]}')`);
    } else if ((m = line.match(/multiple definition of [`'](\w+)'/))) {
      out.push(`${m[1]}() is written in both files (multiple definition of '${m[1]}'). Only one player should write it.`);
    } else if (/collect2(\.exe)?: error: ld returned/.test(line)) {
      out.push('Linking failed: the two files do not fit together yet.');
    } else if (/\bld(\.exe)?: .*(in function|first defined here)/.test(line)) {
      continue;
    } else {
      out.push(line.replace(/^.*?[\\/]ld(\.exe)?: /, 'linker: '));
    }
  }
  return out.filter((l, i) => l !== out[i - 1]).join('\n');
}

// What gets compiled and run.
//   Solo:   main.c on its own.
//   Co-op:  ONE continuous main.c: Player 1's code, then Player 2's code right after it.
//           Player 2 carries on where Player 1 stopped (usually inside the same main()), so they
//           share every variable. Line numbers continue: Player 2's first line is Player 1's
//           last line + 1, exactly like the editors show.
const joinParts = (top, bottom) => `${top}\n${bottom}`;

function programFor(body, problem) {
  if (problem && problem.mode === 'coop') {
    const files = body.files || {};
    const p1 = String(files.p1 ?? ''), p2 = String(files.p2 ?? '');
    if (!p1.trim() && !p2.trim()) return { error: 'Both code boxes are empty.' };
    if (Buffer.byteLength(p1) + Buffer.byteLength(p2) > LIMITS.maxCodeBytes) return { error: 'Code is too large.' };
    return { stages: [{ name: 'team', label: 'Team', sources: [{ name: 'main.c', code: joinParts(p1, p2) }] }] };
  }
  const code = String(body.code || '');
  if (!code.trim()) return { error: 'No code to run.' };
  if (Buffer.byteLength(code) > LIMITS.maxCodeBytes) return { error: 'Code is too large.' };
  return { stages: [{ name: 'main', label: 'main.c', sources: [{ name: 'main.c', code }] }] };
}

// A player's own tests use only that player's code plus the admin's helper:
//   Player 1: Player 1's code + p1TestHelper (code that continues after Player 1, e.g. prints the variables and closes main)
//   Player 2: p2TestHelper (a working version of Player 1's part) + Player 2's code
// If one player wrote the other's part, these no longer compile or give wrong output, so nobody can carry the team.
function partStage(problem, files, part) {
  const mine = String((files || {})[part] ?? '');
  const helper = problem[part + 'TestHelper'] || '';
  const code = part === 'p1' ? joinParts(mine, helper) : joinParts(helper, mine);
  return { name: part, label: part === 'p1' ? 'Player 1' : 'Player 2', sources: [{ name: 'main.c', code }] };
}

// =============== compiler ===============

function compilerPath(name) {
  const local = path.join(LOCAL_GCC_BIN, name + (IS_WIN ? '.exe' : ''));
  return fs.existsSync(local) ? local : name;
}

function childEnv() {
  const env = { ...process.env };
  if (fs.existsSync(LOCAL_GCC_BIN)) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    env[key] = LOCAL_GCC_BIN + path.delimiter + (env[key] || '');
  }
  return env;
}

function runProcess(cmd, args, { cwd, input = '', timeoutMs, maxOutput = LIMITS.maxOutputBytes }) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '', stderr = '', truncated = false, timedOut = false, settled = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: childEnv(), windowsHide: true });
    } catch (err) {
      return resolve({ error: err.message, stdout: '', stderr: '', code: null, ms: 0 });
    }
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, truncated, timedOut, ms: Date.now() - start, ...extra });
    };
    const collect = (which) => (chunk) => {
      const cur = which === 'out' ? stdout : stderr;
      if (cur.length >= maxOutput) {
        if (!truncated) { truncated = true; child.kill(); }
        return;
      }
      const next = cur + chunk.toString('utf8').slice(0, maxOutput - cur.length);
      if (which === 'out') stdout = next; else stderr = next;
    };
    child.stdout.on('data', collect('out'));
    child.stderr.on('data', collect('err'));
    child.stdin.on('error', () => {});
    child.on('error', (err) => finish({ error: err.code === 'ENOENT' ? 'not-found' : err.message, code: null }));
    child.on('close', (code, signal) => finish({ code, signal }));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdin.end(input);
  });
}

let running = 0;
const waiting = [];
async function withSlot(fn) {
  if (running >= LIMITS.maxConcurrentJobs) await new Promise((r) => waiting.push(r));
  running++;
  try { return await fn(); }
  finally { running--; const next = waiting.shift(); if (next) next(); }
}

// Compiles each stage once, then runs every input through the stages in order
// (stage 1's output is stage 2's input). A stage that crashes, times out or prints
// too much stops the pipeline for that input.
async function compileAndRun({ stages, inputs, lang, timeLimitMs, maxOutputs = [], deadline = Infinity }) {
  const cfg = LANGS[lang] || LANGS.c;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'webgcc-'));
  try {
    const exes = [];
    const messages = [];
    let failed = false;
    for (const st of stages) {
      const sub = path.join(dir, st.name);
      await fsp.mkdir(sub);
      for (const f of [...(st.headers || []), ...st.sources]) await fsp.writeFile(path.join(sub, f.name), f.code);
      const exe = path.join(sub, IS_WIN ? 'prog.exe' : 'prog');
      const compile = await runProcess(
        compilerPath(cfg.compiler),
        [...cfg.flags, ...st.sources.map((f) => f.name), '-o', exe, ...cfg.libs],
        { cwd: sub, timeoutMs: LIMITS.compileTimeoutMs },
      );
      if (compile.error === 'not-found') {
        return { ok: false, stage: 'setup', message: `${cfg.compiler} was not found. Run setup-gcc.bat (Windows) or install GCC on the server.` };
      }
      const text = compile.timedOut ? 'Compilation timed out.' : tidyCompileOutput((compile.stderr + compile.stdout).split(sub + path.sep).join(''));
      if (text.trim()) messages.push(stages.length > 1 ? `[${st.label}]\n${text.trim()}` : text.trim());
      if (compile.code !== 0 || !fs.existsSync(exe)) failed = true;
      exes.push(exe);
    }
    const compileOutput = messages.join('\n\n');
    if (failed) return { ok: false, stage: 'compile', compileOutput };

    const runs = [];
    for (const [i, input] of inputs.entries()) {
      if (Date.now() > deadline) { runs.push({ skipped: true }); continue; }
      let data = input, timeMs = 0, failedStage = null, last = null;
      const out = [];
      for (const [k, exe] of exes.entries()) {
        const isLast = k === exes.length - 1;
        const r = await runProcess(exe, [], {
          cwd: path.dirname(exe), input: data, timeoutMs: timeLimitMs,
          // the hand-off between players may be big; the final answer is capped per test
          maxOutput: isLast ? maxOutputs[i] : LIMITS.maxJudgeOutputBytes,
        });
        timeMs += r.ms;
        last = r;
        out.push({ stdout: r.stdout, stderr: r.stderr, exitCode: r.code, timedOut: r.timedOut, truncated: r.truncated, timeMs: r.ms });
        if (r.timedOut || r.code !== 0 || r.truncated) { failedStage = k; break; }
        data = r.stdout;
      }
      const finished = failedStage === null;
      runs.push({
        stdout: finished ? last.stdout : '',
        stderr: out.map((o) => o.stderr).filter(Boolean).join('\n'),
        exitCode: last.code, signal: last.signal ?? null,
        timedOut: last.timedOut, truncated: last.truncated, timeMs,
        failedStage, stages: out,
      });
    }
    return { ok: true, compileOutput, runs, timeLimitMs, stageLabels: stages.map((st) => st.label) };
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// =============== HTTP helpers ===============

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
// Pages and calls that need a logged-in student. The header tells the page to go to the login page
// (e.g. after the same student logged in on another computer).
const LOGIN_PAGES = new Set(['/', '/index.html', '/play.html']);
function needLogin(res) {
  res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Login-Required': '1' });
  res.end(JSON.stringify({ error: 'Please log in again.', login: true }));
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, max) { return JSON.parse((await readBody(req, max)).toString('utf8')); }

async function serveFile(res, file, extraHeaders = {}) {
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// Videos are sent in pieces (HTTP Range) so the browser can start playing and loop without
// downloading the whole file first.
async function serveMedia(req, res, file) {
  let stat;
  try { stat = await fsp.stat(file); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400',
  };
  let start = 0, end = stat.size - 1;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); }
    else start = Math.max(0, stat.size - Number(m[2]));
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  }
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

function serveStatic(pathname, res, extraHeaders) {
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  return serveFile(res, file, extraHeaders);
}

function imageType(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}
function videoType(buf) {
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';   // .mp4 / .m4v / .mov-style files
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  return null;
}

let gccVersion = null;
async function detectGcc() {
  const r = await runProcess(compilerPath('gcc'), ['--version'], { timeoutMs: 10000 });
  gccVersion = r.code === 0 ? r.stdout.split('\n')[0].trim() : null;
  return gccVersion;
}

// =============== routes ===============

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  const method = req.method;
  const problemMatch = pathname.match(/^\/api\/problems\/([\w-]+)$/);
  const testsMatch = pathname.match(/^\/api\/problems\/([\w-]+)\/tests$/);
  const hintMatch = pathname.match(/^\/api\/problems\/([\w-]+)\/hint$/);
  const clanCodeMatch = pathname.match(/^\/api\/clan\/code\/([\w-]+)$/);
  const clanResetMatch = pathname.match(/^\/api\/admin\/clans\/([\w-]+)\/reset$/);

  if (pathname === '/api/info' && method === 'GET') {
    if (!gccVersion) await detectGcc();
    return sendJson(res, 200, { gcc: gccVersion });
  }

  // ---- student login ----
  if (pathname === '/api/login' && method === 'POST') {
    const ip = req.socket.remoteAddress || '';
    const wait = students.blockedFor(ip);
    if (wait) return sendJson(res, 429, { error: `Too many wrong tries. Wait ${wait} seconds and try again.` });
    let body;
    try { body = await readJson(req, 4096); } catch { return sendJson(res, 400, { error: 'Bad request.' }); }
    const r = students.login(body.username, body.password);
    if (!r) { students.noteFail(ip); return sendJson(res, 401, { error: 'Wrong name or password.' }); }
    students.noteOk(ip);
    res.setHeader('Set-Cookie', r.cookie);
    return sendJson(res, 200, { ok: true, user: students.publicUser(r.user) });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', students.logout(req));
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/me' && method === 'GET') {
    const u = students.userOf(req);
    return u ? sendJson(res, 200, { user: students.publicUser(u) }) : needLogin(res);
  }

  if (pathname === '/api/timer' && method === 'GET') return sendJson(res, 200, timerStatus());

  // Loading screen: every .gif in data/gif (read fresh each time, so new files show up straight away).
  if (pathname === '/api/loading-gifs' && method === 'GET') {
    let names = [];
    try { names = (await fsp.readdir(GIF_DIR)).filter((n) => /\.gif$/i.test(n)); } catch {}
    return sendJson(res, 200, names.map((n) => 'loading-gif/' + encodeURIComponent(n)));
  }

  // ---- problems (public read) ----
  if (pathname === '/api/problems' && method === 'GET') {
    // suites: which test sets the mission has (only sets with at least one test), for the map's [T][1][2] boxes
    const list = [];
    for (const p of [...problems].sort(byNumber)) {
      const suites = [];
      for (const s of p.mode === 'coop' ? SUITES : ['team']) if (await testCount(p.id, s)) suites.push(s);
      list.push({ ...summary(p), suites });
    }
    return sendJson(res, 200, list);
  }
  if (problemMatch && method === 'GET') {
    const p = problems.find((x) => x.id === problemMatch[1]);
    if (!p) return sendJson(res, 404, { error: 'Problem not found.' });
    // The hint stays hidden: players only learn whether there is one (the admin gets the text to edit it).
    // The test helpers stay secret too: p2TestHelper is usually a working copy of Player 1's part.
    // (all hints stay hidden: players only learn which views have one)
    const { hint, p1Hint, p2Hint, p1TestHelper, p2TestHelper, p1Solution, p2Solution, ...pub } = p;
    const out = { ...pub, hasHint: hasHint(p), testCount: await testCount(p.id) };
    out.hints = { global: hasHint(p), p1: p.mode === 'coop' && hasHint(p, 'p1'), p2: p.mode === 'coop' && hasHint(p, 'p2') };
    if (p.mode === 'coop') out.partTestCount = { p1: await testCount(p.id, 'p1'), p2: await testCount(p.id, 'p2') };
    if (isAdmin(req)) {
      Object.assign(out, {
        hint: hint || '', p1Hint: p1Hint || '', p2Hint: p2Hint || '',
        p1TestHelper: p1TestHelper || '', p2TestHelper: p2TestHelper || '',
        p1Solution: p1Solution || '', p2Solution: p2Solution || '',
      });
    }
    return sendJson(res, 200, out);
  }
  // A player used one of their hints on this problem.
  if (hintMatch && method === 'GET') {
    if (!students.userOf(req)) return needLogin(res);
    const p = problems.find((x) => x.id === hintMatch[1]);
    // ?for=p1 / p2 asks for one player's hint; nothing else is sent
    const scope = HINT_FIELDS[url.searchParams.get('for')] ? url.searchParams.get('for') : 'global';
    if (!p || !hasHint(p, scope)) return sendJson(res, 404, { error: 'This problem has no hint here.' });
    // In a clan: hints come from the clan's shared pool, and a revealed hint stays open for the whole clan.
    const clan = clans.clanOf(req);
    if (clan && !clans.useHint(clan, p.id, scope)) return sendJson(res, 403, { error: 'Your clan has no hints left.', hintsLeft: 0 });
    return sendJson(res, 200, { hint: p[HINT_FIELDS[scope]], for: scope, ...(clan ? { hintsLeft: clans.hintsLeft(clan) } : {}) });
  }

  // ---- clans: shared progress, score, hints and code ----
  if (pathname === '/api/clans' && method === 'GET') return sendJson(res, 200, clans.CLANS);
  if (pathname === '/api/clan/state' && method === 'GET') {
    if (!students.userOf(req)) return needLogin(res);
    return sendJson(res, 200, clans.stateFor(clans.clanOf(req), problems));
  }
  if (clanCodeMatch) {
    const user = students.userOf(req);
    if (!user) return needLogin(res);
    const clan = clans.clanOf(req);
    if (!clan) return sendJson(res, 400, { error: 'Not playing for a clan.' });
    const pid = clanCodeMatch[1];
    const problem = problems.find((x) => x.id === pid);
    if (!problem) return sendJson(res, 404, { error: 'Problem not found.' });
    const coop = problem.mode === 'coop';
    if (method === 'GET') {
      // the page checks in every 2 s while open: that keeps the student's part from being freed
      if (coop) clans.touchRole(clan, pid, user.username);
      return sendJson(res, 200, {
        ...clans.getCode(clan, pid), resetAt: clans.resetAtOf(clan),
        ...(coop ? { roles: clans.rolesFor(clan, pid), me: user.username } : {}),
      });
    }
    if (method === 'PUT') {
      let body;
      try { body = await readJson(req, LIMITS.maxCodeBytes * 2 + 1024); }
      catch { return sendJson(res, 413, { error: 'Code is too large.' }); }
      const slot = String(body.slot || '');
      const text = String(body.code ?? '');
      if (!clans.CODE_SLOTS.includes(slot)) return sendJson(res, 400, { error: 'Bad code box.' });
      if (Buffer.byteLength(text) > LIMITS.maxCodeBytes) return sendJson(res, 413, { error: 'Code is too large.' });
      // co-op: only the student who took a part can change its code
      if (coop && clans.roleOf(clan, pid, user.username) !== slot) return sendJson(res, 403, { error: 'This is not your part.', notYours: true });
      return sendJson(res, 200, { v: clans.putCode(clan, pid, slot, text) });
    }
    res.writeHead(405); return res.end();
  }

  // co-op parts: { action: 'take', part } | { action: 'leave' } | { action: 'free', part }
  const roleMatch = pathname.match(/^\/api\/clan\/role\/([\w-]+)$/);
  if (roleMatch && method === 'POST') {
    const user = students.userOf(req);
    if (!user) return needLogin(res);
    const clan = clans.clanOf(req);
    if (!clan) return sendJson(res, 400, { error: 'Not playing for a clan.' });
    const problem = problems.find((x) => x.id === roleMatch[1]);
    if (!problem || problem.mode !== 'coop') return sendJson(res, 404, { error: 'Not a co-op problem.' });
    let body;
    try { body = await readJson(req, 1024); } catch { return sendJson(res, 400, { error: 'Bad request.' }); }
    const starters = { p1: problem.p1Starter || COOP_STARTERS.p1, p2: problem.p2Starter || COOP_STARTERS.p2 };
    const err = body.action === 'take' ? clans.takeRole(clan, problem.id, user, String(body.part), starters)
      : body.action === 'leave' ? clans.leaveRole(clan, problem.id, user, starters)
      : body.action === 'free' ? clans.freeRole(clan, problem.id, String(body.part))
      : 'Unknown action.';
    if (err) return sendJson(res, 409, { error: err, roles: clans.rolesFor(clan, problem.id) });
    return sendJson(res, 200, { ok: true, roles: clans.rolesFor(clan, problem.id), me: user.username, ...clans.getCode(clan, problem.id) });
  }

  // ---- admin ----
  const adminRoute = pathname.startsWith('/api/admin/') || pathname === '/api/upload' || pathname === '/api/upload-video'
    || (pathname === '/api/problems' && method === 'POST') || (problemMatch && method !== 'GET') || testsMatch;
  if (adminRoute && !isAdmin(req)) return sendJson(res, 401, { error: 'Wrong admin password.' });

  if (pathname === '/api/admin/check') return sendJson(res, 200, { ok: true });

  // camp timer: { action: 'set', seconds } | 'start' (also resumes) | 'pause' | 'off'
  if (pathname === '/api/admin/timer' && method === 'POST') {
    let body;
    try { body = await readJson(req, 4096); } catch { return sendJson(res, 400, { error: 'Bad request.' }); }
    const left = timeLeftMs();
    if (body.action === 'set') {
      const seconds = body.seconds != null ? Number(body.seconds) : Number(body.minutes) * 60;
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 7 * 24 * 3600) return sendJson(res, 400, { error: 'Enter a time between 1 second and 7 days.' });
      const ms = Math.round(seconds) * 1000;
      timer = { durationMs: ms, remainingMs: ms, endsAt: null };
    } else if (body.action === 'start') {
      if (!timer.durationMs) return sendJson(res, 400, { error: 'Set a time first.' });
      if (left === 0) return sendJson(res, 400, { error: "Time is up. Set a new time to start again." });
      if (!timer.endsAt) timer = { ...timer, endsAt: Date.now() + left };
    } else if (body.action === 'pause') {
      if (timer.endsAt) timer = { ...timer, remainingMs: left, endsAt: null };
    } else if (body.action === 'off') {
      timer = { durationMs: 0, remainingMs: 0, endsAt: null };
    } else {
      return sendJson(res, 400, { error: 'Unknown timer action.' });
    }
    await saveTimer();
    return sendJson(res, 200, timerStatus());
  }

  // every clan's score, cleared missions and hints; reset one clan (testing)
  if (pathname === '/api/admin/clans' && method === 'GET') return sendJson(res, 200, { ...clans.overview(problems), members: students.membersByClan() });
  // add or take away a clan's money by hand: { amount } (negative takes away)
  const moneyMatch = pathname.match(/^\/api\/admin\/clans\/([\w-]+)\/money$/);
  if (moneyMatch && method === 'POST') {
    if (!clans.CLANS.some((c) => c.id === moneyMatch[1])) return sendJson(res, 404, { error: 'No such clan.' });
    let body;
    try { body = await readJson(req, 1024); } catch { return sendJson(res, 400, { error: 'Bad request.' }); }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1e6) return sendJson(res, 400, { error: 'Enter a whole amount, e.g. 50 or -20.' });
    return sendJson(res, 200, { money: clans.addMoney(moneyMatch[1], amount, problems) });
  }

  // reset EVERY clan: progress, scores, money, hints and saved code (logins and the timer are kept)
  if (pathname === '/api/admin/clans/reset-all' && method === 'POST') {
    clans.resetAll();
    return sendJson(res, 200, { ok: true });
  }
  if (clanResetMatch && method === 'POST') {
    if (!clans.CLANS.some((c) => c.id === clanResetMatch[1])) return sendJson(res, 404, { error: 'No such clan.' });
    clans.reset(clanResetMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  if (testsMatch) {
    const id = testsMatch[1];
    if (!problems.some((x) => x.id === id)) return sendJson(res, 404, { error: 'Problem not found.' });
    const suite = SUITES.includes(url.searchParams.get('suite')) ? url.searchParams.get('suite') : 'team';
    if (method === 'GET') return sendJson(res, 200, await readTests(id, suite));
    if (method === 'PUT') {
      let body;
      try { body = await readJson(req, LIMITS.maxTestsBytes); }
      catch (e) { return sendJson(res, e.message === 'too-large' ? 413 : 400, { error: e.message === 'too-large' ? 'Test cases are too large (64 MB max in total).' : 'Bad request.' }); }
      const tests = (Array.isArray(body.tests) ? body.tests : []).slice(0, LIMITS.maxTests)
        .map((t) => ({ input: String((t && t.input) ?? ''), output: String((t && t.output) ?? '') }));
      await writeTests(id, tests, suite);
      testCounts.set(`${id}:${suite}`, tests.length);
      return sendJson(res, 200, { ok: true, count: tests.length });
    }
    res.writeHead(405); return res.end();
  }

  if (pathname === '/api/problems' && method === 'POST') {
    let p;
    try { p = cleanProblem(await readJson(req, LIMITS.maxProblemBytes)); }
    catch (e) { return sendJson(res, 400, { error: e.message === 'too-large' ? 'Problem is too large.' : e.message }); }
    if (numberTaken(p)) return sendJson(res, 409, { error: `${levelName(p.difficulty)} already has a problem number ${p.number}.` });
    const now = new Date().toISOString();
    p = { id: 'p' + crypto.randomBytes(5).toString('hex'), ...p, createdAt: now, updatedAt: now };
    problems.push(p);
    await saveProblem(p);
    return sendJson(res, 201, p);
  }
  if (problemMatch && method === 'PUT') {
    const i = problems.findIndex((x) => x.id === problemMatch[1]);
    if (i < 0) return sendJson(res, 404, { error: 'Problem not found.' });
    let p;
    try { p = cleanProblem(await readJson(req, LIMITS.maxProblemBytes)); }
    catch (e) { return sendJson(res, 400, { error: e.message === 'too-large' ? 'Problem is too large.' : e.message }); }
    if (numberTaken(p, problems[i].id)) return sendJson(res, 409, { error: `${levelName(p.difficulty)} already has a problem number ${p.number}.` });
    problems[i] = { ...problems[i], ...p, updatedAt: new Date().toISOString() };
    await saveProblem(problems[i]);
    return sendJson(res, 200, problems[i]);
  }
  if (problemMatch && method === 'DELETE') {
    const before = problems.length;
    problems = problems.filter((x) => x.id !== problemMatch[1]);
    if (problems.length === before) return sendJson(res, 404, { error: 'Problem not found.' });
    await removeProblemFile(problemMatch[1]);
    for (const suite of SUITES) {
      fsp.rm(testsFile(problemMatch[1], suite), { force: true }).catch(() => {});
      testCounts.delete(`${problemMatch[1]}:${suite}`);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/upload' && method === 'POST') {
    let buf;
    try { buf = await readBody(req, LIMITS.maxUploadBytes); }
    catch { return sendJson(res, 413, { error: 'Image is too large (max 5 MB).' }); }
    const type = imageType(buf);
    if (!type) return sendJson(res, 400, { error: 'Only PNG, JPG, GIF and WebP images are allowed.' });
    const name = crypto.randomBytes(16).toString('hex') + '.' + type;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
    return sendJson(res, 201, { url: 'uploads/' + name });
  }
  if (pathname === '/api/upload-video' && method === 'POST') {
    let buf;
    try { buf = await readBody(req, LIMITS.maxVideoBytes); }
    catch { return sendJson(res, 413, { error: 'Video is too large (max 100 MB).' }); }
    const type = videoType(buf);
    if (!type) return sendJson(res, 400, { error: 'Only MP4 and WebM videos are allowed.' });
    const name = crypto.randomBytes(16).toString('hex') + '.' + type;
    await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
    return sendJson(res, 201, { url: 'uploads/' + name });
  }

  // ---- submit: judge against the hidden test cases ----
  // Everything about the hidden tests stays secret: only one symbol per test goes back, e.g. "PPF-T".
  //   P passed · F failed (wrong answer) · - blank (no output) · T time limit (too slow / infinite loop)
  //   X crashed · E error exit (main returned non-zero) · O output too long · C compile error · S skipped
  // No compiler messages, times, inputs or outputs are sent.
  // Co-op: the team tests check the whole program; each player's own tests check only their part.
  // body.part = 'p1' or 'p2' runs just that player's tests ("Check my part").
  if (pathname === '/api/submit' && method === 'POST') {
    if (!students.userOf(req)) return needLogin(res);
    if (timeIsUp() && !isAdmin(req)) return sendJson(res, 403, { ok: false, stage: 'request', message: "Time's up! Submitting is closed. You can still read the problems and run your code." });
    let body;
    try { body = await readJson(req, LIMITS.maxCodeBytes * 2 + 4096); }
    catch (e) { return sendJson(res, e.message === 'too-large' ? 413 : 400, { ok: false, stage: 'request', message: e.message === 'too-large' ? 'Code is too large.' : 'Bad request.' }); }
    const problem = problems.find((x) => x.id === body.problemId);
    if (!problem) return sendJson(res, 404, { ok: false, stage: 'request', message: 'Problem not found.' });
    const coop = problem.mode === 'coop';
    // co-op in a clan: only the clan's Player 1 and Player 2 of this problem can submit
    if (coop && clans.clanOf(req) && !clans.roleOf(clans.clanOf(req), problem.id, students.userOf(req).username)) {
      return sendJson(res, 403, { ok: false, stage: 'request', message: 'Take Player 1 or Player 2 to submit. Only the two players can submit.' });
    }
    const part = coop && ['p1', 'p2'].includes(body.part) ? body.part : null;
    const files = body.files || {};

    const plan = [];   // [{ suite, stage }]
    if (!part) {
      const program = programFor(body, problem);
      if (program.error) return sendJson(res, 400, { ok: false, stage: 'request', message: program.error });
      plan.push({ suite: 'team', stage: program.stages[0] });
    }
    if (coop) {
      for (const pt of part ? [part] : ['p1', 'p2']) {
        // "Check my part" needs some code; a full Submit still runs an empty player's tests (they fail)
        if (part && !String(files[pt] ?? '').trim()) {
          return sendJson(res, 400, { ok: false, stage: 'request', message: `${pt === 'p1' ? "Player 1's" : "Player 2's"} code is empty.` });
        }
        plan.push({ suite: pt, stage: partStage(problem, files, pt) });
      }
    }
    const suites = [];
    for (const step of plan) {
      const tests = await readTests(problem.id, step.suite);
      if (tests.length) suites.push({ ...step, tests });
    }
    if (!suites.length) return sendJson(res, 400, { ok: false, stage: 'request', message: 'This problem has no test cases yet.' });

    const timeLimitMs = Math.min(LIMITS.maxRunTimeoutMs, Math.round(problem.timeLimit * 1000));
    const deadline = Date.now() + LIMITS.maxJudgeMs;
    const crashed = (r) => r.signal != null || r.exitCode == null || r.exitCode < 0 || r.exitCode >= 0xC0000000;
    const matchOptions = { flexible: problem.customScript === true, clanNames: clanNamesFor(clans.clanOf(req)) };
    const reply = { ok: true };
    for (const { suite, stage, tests } of suites) {
      const result = await withSlot(() => compileAndRun({
        stages: [stage], lang: body.lang, timeLimitMs, deadline,
        inputs: tests.map((t) => t.input),
        maxOutputs: tests.map((t) => Math.min(LIMITS.maxJudgeOutputBytes, Math.max(LIMITS.maxOutputBytes, t.output.length * 2 + 4096))),
      }));
      let marks;
      if (!result.ok && result.stage === 'compile') marks = 'C'.repeat(tests.length);
      else if (!result.ok) return sendJson(res, 200, { ok: false, stage: result.stage, message: result.message });
      else {
        marks = result.runs.map((r, i) => {
          if (r.skipped) return 'S';
          if (r.timedOut) return 'T';
          if (r.truncated) return 'O';
          if (r.exitCode !== 0) return crashed(r) ? 'X' : 'E';
          if (OutputMatch.matches(r.stdout, tests[i].output, matchOptions)) return 'P';
          return r.stdout.trim() === '' ? '-' : 'F';
        }).join('');
      }
      const summary = { result: marks, passed: [...marks].filter((m) => m === 'P').length, total: tests.length };
      if (suite === 'team') Object.assign(reply, summary);
      else (reply.parts ||= {})[suite] = summary;
    }
    // A full Submit by a clan member counts for the whole clan (a "Check my part" doesn't).
    const clan = clans.clanOf(req);
    if (clan && !part) {
      const sets = [reply.total != null ? reply : null, ...Object.values(reply.parts || {})].filter(Boolean);
      const passed = sets.reduce((n, x) => n + x.passed, 0), total = sets.reduce((n, x) => n + x.total, 0);
      const accepted = sets.length > 0 && sets.every((x) => x.passed === x.total);
      clans.recordSubmit(clan, problem.id, passed, total, accepted,
        { ...(reply.total != null ? { team: { passed: reply.passed, total: reply.total } } : {}), ...(reply.parts || {}) });
      reply.cleared = accepted;
    }
    return sendJson(res, 200, reply);
  }

  // ---- compile & run ----
  if (pathname === '/api/run' && method === 'POST') {
    let body;
    try { body = await readJson(req, LIMITS.maxCodeBytes * 2 + LIMITS.maxStdinBytes * 2 + 4096); }
    catch (e) { return sendJson(res, e.message === 'too-large' ? 413 : 400, { ok: false, stage: 'request', message: e.message === 'too-large' ? 'Code or input is too large.' : 'Bad request.' }); }
    const inputs = (Array.isArray(body.inputs) ? body.inputs : [body.stdin || ''])
      .slice(0, LIMITS.maxInputsPerRun).map((s) => String(s ?? ''));
    const problem = problems.find((x) => x.id === body.problemId);
    const program = programFor(body, problem);
    if (program.error) return sendJson(res, 400, { ok: false, stage: 'request', message: program.error });
    const timeLimitMs = problem
      ? Math.min(LIMITS.maxRunTimeoutMs, Math.round(problem.timeLimit * 1000))
      : LIMITS.defaultRunTimeoutMs;
    const result = await withSlot(() => compileAndRun({ ...program, inputs, lang: body.lang, timeLimitMs }));
    // Show at most 64 KB of each player's output in the browser.
    if (result.ok) {
      for (const r of result.runs) {
        for (const st of r.stages || []) {
          if (st.stdout.length > LIMITS.maxOutputBytes) { st.stdout = st.stdout.slice(0, LIMITS.maxOutputBytes); st.truncated = true; }
        }
      }
    }
    return sendJson(res, 200, result);
  }

  if (method !== 'GET') { res.writeHead(405); return res.end(); }

  const upload = pathname.match(/^\/uploads\/([a-f0-9]{32}\.(?:png|jpg|gif|webp|mp4|webm))$/);
  if (upload) {
    const file = path.join(UPLOAD_DIR, upload[1]);
    return /\.(mp4|webm)$/.test(file) ? serveMedia(req, res, file) : serveFile(res, file);
  }

  const loadingGif = pathname.match(/^\/loading-gif\/([^/]+)$/);
  if (loadingGif) {
    const name = decodeURIComponent(loadingGif[1]);
    // a plain file name inside data/gif only (no slashes, so no way out of the folder)
    if (!/^[^/\\]+\.gif$/i.test(name)) { res.writeHead(404); return res.end('Not found'); }
    return serveFile(res, path.join(GIF_DIR, name), { 'Cache-Control': 'public, max-age=3600' });
  }

  // The map and the problem pages are for logged-in students only; the login page is for everyone else.
  if (LOGIN_PAGES.has(pathname) && !students.userOf(req)) {
    const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname.slice(1) + url.search)}`;
    res.writeHead(302, { Location: 'login.html' + next, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (pathname === '/login.html' && students.userOf(req)) {
    res.writeHead(302, { Location: './', 'Cache-Control': 'no-store' });
    return res.end();
  }
  const noStore = LOGIN_PAGES.has(pathname) || pathname === '/login.html' ? { 'Cache-Control': 'no-store' } : undefined;
  return serveStatic(decodeURIComponent(pathname), res, noStore);
}

loadProblems();
clans.load(DATA_DIR);
const studentCount = students.load(DATA_DIR, new Set(clans.CLANS.map((c) => c.id)));
if (!studentCount) console.warn('No students in data/students.json: nobody can log in to the main page.');

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, stage: 'server', message: 'Server error.' });
  });
});

server.listen(PORT, HOST, async () => {
  console.log(`Practice site:  http://localhost:${PORT}`);
  console.log(`Admin page:     http://localhost:${PORT}/admin.html`);
  console.log(`Admin password: ${ADMIN_PASSWORD}   (change it in data/admin-password.txt)`);
  const v = await detectGcc();
  console.log(v ? `Compiler:       ${v}` : 'WARNING: GCC not found. Run setup-gcc.bat first (or install GCC on this server).');
});
