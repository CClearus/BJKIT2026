// Compares a program's output with the expected output. Used by the server (Submit), the problem page (Run)
// and the admin page (check with my solution), so all three always agree.
//
// Normal problems: exact match, ignoring trailing spaces and blank lines at the end.
// "Custom script" problems: the expected output may also hold placeholders:
//   {string}  any text on that line (at least 1 character)    Hello, My name is {string}
//   {clan}    the student's own clan, English or Thai          We are from {clan}
//   {word}    one word, no spaces
//   {int}     a whole number: 7, -12
//   {number}  any number: 3, -0.5, 2.75
//   {any}     anything on that line, even nothing
// A placeholder never spans lines. Everything else must match exactly (upper/lower case too).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OutputMatch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const normalize = (s) => String(s ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trimEnd();

  const KINDS = ['string', 'clan', 'word', 'int', 'number', 'any'];
  const TOKENS = new RegExp(`\\{(${KINDS.join('|')})\\}`, 'g');
  const HAS = new RegExp(`\\{(?:${KINDS.join('|')})\\}`);
  const hasPlaceholders = (s) => HAS.test(String(s ?? ''));
  // what the paper shows instead of each placeholder
  const LABELS = { string: 'any text', clan: 'your clan', word: 'one word', int: 'whole number', number: 'number', any: 'anything' };

  const INT = /^[+-]?\d+$/;
  const NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const MAX_LINE = 2000;   // longer output lines can't match a line with placeholders (keeps the check fast)

  // "Hello, My name is {string}" -> ['Hello, My name is ', { kind: 'string' }]
  function parse(line) {
    const parts = [];
    let last = 0;
    for (const m of line.matchAll(TOKENS)) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push({ kind: m[1] });
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts;
  }

  // Does `text` match the parts? Tries each place a placeholder could end, remembering what failed,
  // so it stays fast however the placeholders are arranged.
  function matchLine(text, parts, clanNames) {
    const n = text.length;
    const failed = new Set();
    const go = (i, pos) => {
      if (i === parts.length) return pos === n;
      const key = i * (n + 1) + pos;
      if (failed.has(key)) return false;
      const part = parts[i];
      let ok = false;
      if (typeof part === 'string') ok = text.startsWith(part, pos) && go(i + 1, pos + part.length);
      else {
        const next = parts[i + 1];
        const isEnd = (e) => (next === undefined ? e === n : typeof next !== 'string' || text.startsWith(next, e));
        if (part.kind === 'clan') {
          ok = clanNames.some((c) => c && text.startsWith(c, pos) && isEnd(pos + c.length) && go(i + 1, pos + c.length));
        } else {
          const min = part.kind === 'any' ? 0 : 1;
          const space = text.slice(pos).search(/\s/);
          const max = part.kind === 'word' ? (space < 0 ? n : pos + space)
            : part.kind === 'int' || part.kind === 'number' ? Math.min(n, pos + 64) : n;
          for (let e = pos + min; e <= max && !ok; e++) {
            if (!isEnd(e)) continue;
            if (part.kind === 'int' && !INT.test(text.slice(pos, e))) continue;
            if (part.kind === 'number' && !NUM.test(text.slice(pos, e))) continue;
            ok = go(i + 1, e);
          }
        }
      }
      if (!ok) failed.add(key);
      return ok;
    };
    return go(0, 0);
  }

  /**
   * got: what the program printed. want: the expected output.
   * options.flexible: true for a "Custom script" problem (placeholders count); otherwise an exact match.
   * options.clanNames: names that count for {clan} (the student's clan in English and Thai).
   */
  function matches(got, want, options = {}) {
    const g = normalize(got), w = normalize(want);
    if (!options.flexible || !hasPlaceholders(w)) return g === w;
    const gl = g.split('\n'), wl = w.split('\n');
    if (gl.length !== wl.length) return false;
    const clanNames = (options.clanNames || []).filter(Boolean).sort((a, b) => b.length - a.length);
    return wl.every((line, i) => {
      // "Note: {any}" with nothing after it prints "Note: ", which is trimmed to "Note:"
      if (/\s\{any\}$/.test(line) && gl[i] === line.replace(/\s+\{any\}$/, '')) return true;
      if (!hasPlaceholders(line)) return line === gl[i];
      return gl[i].length <= MAX_LINE && matchLine(gl[i], parse(line), clanNames);
    });
  }

  return { normalize, matches, hasPlaceholders, parse, LABELS };
});
