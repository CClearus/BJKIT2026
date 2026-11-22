// Renders a problem as a competition test paper. Shared by the main page and the admin preview.
(function () {
  // ---------- HTML sanitizer (only safe formatting survives) ----------
  const ALLOWED = {
    P: [], DIV: [], BR: [], B: [], STRONG: [], I: [], EM: [], U: [], S: [], SUB: [], SUP: [],
    CODE: [], PRE: [], H3: [], H4: [], UL: [], OL: [], LI: [], BLOCKQUOTE: [], SPAN: [], HR: [],
    TABLE: [], THEAD: [], TBODY: [], TR: [], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'],
    IMG: ['src', 'alt'], A: ['href'],
    // a video is stored as <figure data-video="link"></figure> and turned into a player when shown
    FIGURE: ['data-video'],
  };
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'TEXTAREA', 'BUTTON', 'SELECT']);
  const STYLE_OK = new Set(['text-align', 'width', 'display', 'margin-left', 'margin-right']);
  const IMG_SRC = /^\/?uploads\/[a-f0-9]{32}\.(png|jpg|gif|webp)$|^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;

  function cleanStyle(style) {
    const out = [];
    for (const part of String(style || '').split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const prop = part.slice(0, i).trim().toLowerCase();
      const val = part.slice(i + 1).trim();
      if (STYLE_OK.has(prop) && /^[\w\s.%-]+$/.test(val)) out.push(`${prop}: ${val}`);
    }
    return out.join('; ');
  }

  function cleanNode(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toUpperCase();
      if (DROP.has(tag)) { child.remove(); continue; }
      if (!(tag in ALLOWED)) {
        cleanNode(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const style = cleanStyle(child.getAttribute('style'));
      for (const attr of [...child.attributes]) {
        if (!ALLOWED[tag].includes(attr.name.toLowerCase())) child.removeAttribute(attr.name);
      }
      if (style) child.setAttribute('style', style);
      if (tag === 'FIGURE') {
        // only a known video link survives; the figure keeps nothing else inside it
        const v = parseVideo(child.getAttribute('data-video'));
        if (!v) { cleanNode(child); child.replaceWith(...child.childNodes); continue; }
        child.setAttribute('data-video', v.url);
        child.textContent = '';
        continue;
      }
      if (tag === 'IMG' && !IMG_SRC.test(child.getAttribute('src') || '')) { child.remove(); continue; }
      if (tag === 'A') {
        if (!/^https?:\/\//i.test(child.getAttribute('href') || '')) child.removeAttribute('href');
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      cleanNode(child);
    }
  }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    cleanNode(doc.body);
    return doc.body.innerHTML;
  }

  function isBlank(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    return !doc.body.textContent.trim() && !doc.body.querySelector('img, figure[data-video]');
  }

  // ---------- videos ----------
  // An MP4/WebM video: one uploaded to this site (uploads/<id>.mp4), or a direct link to a video file.
  // Returns { src, url } with url = what gets stored, or null.
  const VIDEO_UPLOAD = /^\/?uploads\/[a-f0-9]{32}\.(?:mp4|webm)$/;
  function parseVideo(link) {
    const s = String(link || '').trim();
    if (VIDEO_UPLOAD.test(s)) { const url = s.replace(/^\//, ''); return { src: url, url }; }
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return /\.(mp4|webm|m4v|ogv|mov)$/i.test(u.pathname) ? { src: u.href, url: u.href } : null;
  }

  // Turn every stored <figure data-video> inside root into a video that plays on its own, looping,
  // with the sound on at half volume.
  // Browsers block sound until the viewer has clicked or pressed a key on the page. If that happens
  // the video plays muted for now and the sound comes on with the viewer's first click or key press.
  const VIDEO_VOLUME = 0.5;
  const waitingForSound = new Set();
  const UNMUTE_EVENTS = ['pointerdown', 'keydown', 'touchend'];
  function unmuteWaiting(e) {
    for (const m of waitingForSound) {
      // a click on the video itself is left to its own controls (e.g. its mute button)
      if (m !== e.target && m.isConnected) { m.volume = VIDEO_VOLUME; m.muted = false; }
    }
    waitingForSound.clear();
    for (const t of UNMUTE_EVENTS) document.removeEventListener(t, unmuteWaiting, true);
  }
  function playWithSound(media) {
    media.volume = VIDEO_VOLUME;
    media.muted = false;
    const started = media.play();
    if (!started) return;
    started.catch(() => {
      media.muted = true;
      media.play().catch(() => {});
      if (!waitingForSound.size) for (const t of UNMUTE_EVENTS) document.addEventListener(t, unmuteWaiting, true);
      waitingForSound.add(media);
    });
  }
  function mountVideos(root) {
    for (const fig of root.querySelectorAll('figure[data-video]')) {
      const v = parseVideo(fig.getAttribute('data-video'));
      if (!v) { fig.remove(); continue; }
      fig.className = 'p-video';
      fig.textContent = '';
      const media = document.createElement('video');
      Object.assign(media, { loop: true, playsInline: true, controls: true, preload: 'auto', src: v.src });
      fig.appendChild(media);
      playWithSound(media);
    }
  }

  // put sanitized rich text into an element, with working video players
  function setRich(target, html) {
    target.innerHTML = sanitize(html);
    mountVideos(target);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------- difficulty levels ----------
  // 0 stars (example missions: no points, just to learn how it works), 1-5 stars (green -> red),
  // 6 stars (purple), and a special level with its own symbol.
  const SPECIAL_SYMBOL = '◆';
  const LEVELS = ['0', '1', '2', '3', '4', '5', '6', 'special'];

  function normalizeLevel(d) {
    const s = String(d ?? '').toLowerCase();
    if (LEVELS.includes(s)) return s;
    return { easy: '1', medium: '3', hard: '5' }[s] || '1';
  }
  const levelName = (l) => (normalizeLevel(l) === 'special' ? 'Special' : normalizeLevel(l) === '0' ? 'Example (no points)' : `Level ${normalizeLevel(l)}`);
  const levelOrder = (l) => (normalizeLevel(l) === 'special' ? 7 : Number(normalizeLevel(l)));
  // plain-text stars, for places that can't be colored (like <option>)
  function starsText(l) {
    const v = normalizeLevel(l);
    if (v === 'special') return `${SPECIAL_SYMBOL} Special`;
    if (v === '0') return '☆ Example';
    const n = Number(v);
    return n === 6 ? '★★★★★★' : '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  // Colored stars. Only the special and example levels show a word next to their symbol.
  function levelElement(l, { specialLabel = 'Special' } = {}) {
    const v = normalizeLevel(l);
    const wrap = el('span', `level lv-${v}`);
    wrap.title = levelName(v);
    const stars = el('span', 'stars');
    stars.setAttribute('aria-hidden', 'true');
    if (v === 'special') stars.textContent = SPECIAL_SYMBOL;
    else if (v === '0') stars.textContent = '☆';
    else {
      const n = Number(v);
      stars.textContent = '★'.repeat(n);
      if (n < 5) stars.appendChild(el('span', 'off', '★'.repeat(5 - n)));
    }
    wrap.appendChild(stars);
    if (v === 'special') wrap.appendChild(el('span', 'lv-name', specialLabel));
    else if (v === '0') wrap.appendChild(el('span', 'lv-name', 'Example'));
    else wrap.appendChild(el('span', 'sr-only', levelName(v)));
    return wrap;
  }

  // ---------- labels ----------
  // Headings and labels are always English. Content (title, story, input/output text) is shown
  // in TH SarabunPSK for Thai characters and the formal serif font for English (see theme.css).
  const THAI = /[฀-๿]/;
  const L = {
    problem: (n) => `Problem ${n}`, time: 'Time limit', memory: 'Memory limit',
    seconds: (n) => `${n} second${Number(n) === 1 ? '' : 's'}`, mb: (n) => `${n} MB`,
    input: 'Input', output: 'Output', constraints: 'Constraints', example: 'Example', examples: 'Examples',
    copy: 'Copy', copied: 'Copied', use: 'Use ↗', madeBy: 'Made by', special: 'Special',
  };
  // "Made by": a list of { name, avatar }. Older problems stored plain names (or one name).
  const authorList = (v) => (Array.isArray(v) ? v : [v]).map((x) => {
    const o = x && typeof x === 'object' ? x : { name: x };
    return { name: String(o.name ?? '').trim(), avatar: String(o.avatar || '') };
  }).filter((a) => a.name);
  // a round picture, or the first letter of the name when there is no picture
  function avatarEl(a, cls) {
    if (/^uploads\/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/.test(a.avatar)) {
      const img = el('img', cls);
      img.src = a.avatar;
      img.alt = '';
      img.loading = 'lazy';
      return img;
    }
    const span = el('span', cls + ' initial', [...a.name][0].toUpperCase());
    span.setAttribute('aria-hidden', 'true');
    return span;
  }

  // ---------- rendering ----------
  function section(paper, title, html) {
    if (isBlank(html)) return;
    paper.appendChild(el('h2', null, title));
    const body = el('div', 'p-section');
    setRich(body, html);
    paper.appendChild(body);
  }

  // {clan} in the text: the reader's clan name, bold in the clan's color ("[ชื่อเมือง]" when there is no clan,
  // e.g. the admin preview). Placeholders in the examples of a "Custom script" problem become chips.
  function fillPlaceholders(root, p, clan) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.includes('{')) texts.push(n);
    const labels = (window.OutputMatch && OutputMatch.LABELS) || {};
    for (const node of texts) {
      const inSample = !!node.parentElement.closest('table.samples');
      const re = inSample && p.customScript ? /\{(string|clan|word|int|number|any)\}/g : /\{(clan)\}/g;
      if (!re.test(node.nodeValue)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of node.nodeValue.matchAll(re)) {
        frag.append(node.nodeValue.slice(last, m.index));
        if (inSample) {
          frag.appendChild(el('span', 'p-ph', labels[m[1]] || m[1]));
        } else {
          const b = el('b', 'p-clan', clan ? clan.thai : '[ชื่อเมือง]');
          if (clan) { b.style.setProperty('--clan', clan.color); b.title = clan.name; }
          frag.appendChild(b);
        }
        last = m.index + m[0].length;
      }
      frag.append(node.nodeValue.slice(last));
      node.replaceWith(frag);
    }
  }

  function renderMath(root) {
    if (!window.renderMathInElement) return;
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        ignoredClasses: ['samples'],
        throwOnError: false,
      });
    } catch (e) { /* leave raw text if math fails */ }
  }

  // Example tables (Input | Output) with a Copy button
  function sampleTables(root, list, options = {}) {
    const samples = (list || []).filter((s) => s && (s.input || s.output));
    if (!samples.length) return;
    root.appendChild(el('h2', null, samples.length === 1 ? L.example : L.examples));
    samples.forEach((s, i) => {
      const t = el('table', 'samples');
      const tr1 = el('tr');
      const num = samples.length > 1 ? ` ${i + 1}` : '';
      const thIn = el('th', null, L.input + num);
      const thOut = el('th', null, L.output + num);
      const actions = el('span', 's-actions');
      const copy = el('button', 's-btn', L.copy);
      copy.type = 'button';
      copy.addEventListener('click', () => {
        navigator.clipboard?.writeText(s.input).then(() => { copy.textContent = L.copied; setTimeout(() => (copy.textContent = L.copy), 1200); });
      });
      actions.appendChild(copy);
      if (options.onUseSample) {
        const use = el('button', 's-btn', L.use);
        use.type = 'button';
        use.addEventListener('click', () => options.onUseSample(i, s));
        actions.appendChild(use);
      }
      thIn.appendChild(actions);
      tr1.append(thIn, thOut);
      const tr2 = el('tr');
      const tdIn = el('td'); tdIn.appendChild(el('pre', null, s.input));
      const tdOut = el('td'); tdOut.appendChild(el('pre', null, s.output));
      tr2.append(tdIn, tdOut);
      t.append(tr1, tr2);
      root.appendChild(t);
    });
  }

  // The whole problem (also the only view for solo problems)
  function renderGlobal(root, p, options) {
    if (!isBlank(p.statement)) {
      const st = el('div', 'p-section');
      setRich(st, p.statement);
      root.appendChild(st);
    }
    section(root, L.input, p.input);
    section(root, L.output, p.output);
    section(root, L.constraints, p.constraints);
    sampleTables(root, p.samples, options);
  }

  // One player's objective: explanation, output and examples only
  // Same look as the Global sections: an "Objective" heading styled like "Output", then Output and Examples.
  // (The toggle above already shows whose sheet this is.)
  function renderPlayer(root, p, n) {
    const task = p[`p${n}Task`], out = p[`p${n}Output`];
    const samples = (p[`p${n}Samples`] || []).filter((s) => s && (s.input || s.output));
    if (isBlank(task) && isBlank(out) && !samples.length) {
      root.appendChild(el('p', 'empty-note', `No objective has been written for Player ${n} yet.`));
      return;
    }
    section(root, 'Objective', task);
    section(root, L.output, out);
    sampleTables(root, samples);
  }

  const VIEWS = [['global', 'Global'], ['p1', 'Player 1'], ['p2', 'Player 2']];

  /**
   * Render problem `p` into `paper` (an <article class="paper">).
   * Co-op problems get a Global / Player 1 / Player 2 toggle; the chosen view is kept in paper.dataset.view.
   */
  function renderProblem(paper, p, options = {}) {
    paper.textContent = '';
    const coop = p.mode === 'coop';
    if (p.customScript) {
      // Font Awesome "code" icon (CC BY 4.0, fontawesome.com)
      const icon = el('span', 'p-script');
      icon.title = 'Custom script';
      icon.setAttribute('role', 'img');
      icon.setAttribute('aria-label', 'Custom script');
      icon.innerHTML = '<svg viewBox="0 0 640 512" aria-hidden="true"><path fill="currentColor" d="M392.8 1.2c-17-4.9-34.7 5-39.6 22l-128 448c-4.9 17 5 34.7 22 39.6s34.7-5 39.6-22l128-448c4.9-17-5-34.7-22-39.6zm80.6 120.1c-12.5 12.5-12.5 32.8 0 45.3L562.7 256l-89.4 89.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l112-112c12.5-12.5 12.5-32.8 0-45.3l-112-112c-12.5-12.5-32.8-12.5-45.3 0zm-306.7 0c-12.5-12.5-32.8-12.5-45.3 0l-112 112c-12.5 12.5-12.5 32.8 0 45.3l112 112c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L77.3 256l89.4-89.4c12.5-12.5 12.5-32.8 0-45.3z"/></svg>';
      paper.appendChild(icon);
    }

    const head = el('header', 'p-head');
    const label = el('div', 'p-label');
    label.append(levelElement(p.difficulty, { specialLabel: L.special }), el('span', 'p-dot', '·'), el('span', 'p-num', L.problem(p.number || '?')));
    head.appendChild(label);
    head.appendChild(el('h1', 'p-title', p.name || 'Untitled problem'));
    const meta = el('div', 'p-meta');
    const tl = el('span'); tl.append(`${L.time} `); tl.appendChild(el('b', null, L.seconds(p.timeLimit ?? 1)));
    const ml = el('span'); ml.append(`${L.memory} `); ml.appendChild(el('b', null, L.mb(p.memoryLimit ?? 256)));
    meta.append(tl, ml);
    head.appendChild(meta);

    const body = el('div', 'p-body');
    const tabs = el('div', 'p-views');
    const show = (view) => {
      paper.dataset.view = view;
      for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.view === view));
      body.textContent = '';
      body.className = `p-body view-${view}`;
      if (view === 'global') renderGlobal(body, p, options);
      else renderPlayer(body, p, view === 'p1' ? 1 : 2);
      fillPlaceholders(body, p, options.clan);
      showScopeHint(paper, p, options.hint, view);   // each view has its own hint
      renderMath(body);
      const hintSec = paper.querySelector('.p-hint');
      if (hintSec) renderMath(hintSec);
      if (paper.isConnected) ThaiDistribute.apply(paper);
    };
    if (coop) {
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Objective');
      for (const [view, name] of VIEWS) {
        const b = el('button');
        b.type = 'button';
        b.dataset.view = view;
        b.setAttribute('role', 'tab');
        b.append(el('span', 'dot'), name);
        b.addEventListener('click', () => { if (paper.dataset.view !== view) show(view); });
        tabs.appendChild(b);
      }
      head.appendChild(tabs);
    }
    paper.appendChild(head);
    paper.appendChild(body);
    const start = coop && ['global', 'p1', 'p2'].includes(paper.dataset.view) ? paper.dataset.view : 'global';
    show(start);


    const credits = el('footer', 'p-credits');
    const authors = authorList(p.madeBy);
    credits.appendChild(el('span', 'c-key', L.madeBy));
    if (authors.length) {
      const names = el('ul', 'c-names');
      for (const a of authors) {
        const li = el('li');
        li.append(avatarEl(a, 'c-av'), el('span', 'c-name', a.name));
        names.appendChild(li);
      }
      credits.appendChild(names);
    } else credits.appendChild(el('span', 'c-val placeholder', '—'));
    paper.appendChild(credits);

    renderMath(credits);
    ThaiDistribute.apply(paper);
  }

  // ---------- hint ----------
  // Every view of the sheet has its own hint: the Global view uses p.hint, the Player 1 / Player 2
  // views use p.p1Hint / p.p2Hint. Using a hint only opens the hint of the view you are on.
  // The section stays hidden until it is used, with Verity (the button in the top-right corner).
  // opts: { mode: 'locked' | 'open' | 'preview', html, left (hints the player has), onReveal() }
  const HINT_FIELD = { global: 'hint', p1: 'p1Hint', p2: 'p2Hint' };
  const HINT_WHO = { global: '', p1: 'Player 1', p2: 'Player 2' };
  // Does this view have a hint? (players only get a yes/no from the server, the admin preview has the text)
  function hasScopeHint(p, scope) {
    if (scope === 'global' && p.hasHint) return true;
    if (p.hints && p.hints[scope]) return true;
    return !isBlank(p[HINT_FIELD[scope]]);
  }

  function hintSection(html, note, scope = 'global') {
    const box = el('section', `p-hint scope-${scope}`);
    const head = el('h2', 'h-head');
    head.append(el('span', null, HINT_WHO[scope] ? `${HINT_WHO[scope]} hint` : 'Hint'));
    if (note) head.appendChild(el('span', 'h-note', note));
    const body = el('div', 'p-section h-body');
    setRich(body, html);
    box.append(head, body);
    return box;
  }
  // the hint section sits right after the sheet's content, before "Made by"
  function placeHintSection(paper, sec) {
    const body = paper.querySelector('.p-body');
    if (body) body.after(sec); else paper.insertBefore(sec, paper.querySelector('.p-credits'));
  }

  // The hint button is Verity, the yellow ball.
  const VERITY = '<img src="icons/verity.png" alt="" draggable="false">';

  function addHint(paper, p, opts, scope = 'global') {
    const who = HINT_WHO[scope] ? ` for ${HINT_WHO[scope]}` : '';
    if (opts.mode === 'preview') {
      placeHintSection(paper, hintSection(p[HINT_FIELD[scope]] || '', 'Hidden until a player uses a hint', scope));
      return;
    }
    const btn = el('button', 'p-hint-btn');
    btn.type = 'button';
    paper.appendChild(btn);
    if (opts.mode === 'open') {
      placeHintSection(paper, hintSection(opts.html || '', null, scope));
      showJump(btn, paper);
      return;
    }
    const left = opts.left ?? 0;
    // Just Verity. Her look shows the state; hovering gives a short label.
    btn.innerHTML = VERITY;
    const label = (t) => { btn.title = t; btn.setAttribute('aria-label', t); };
    const idle = () => { btn.classList.remove('armed'); label(`Ask Verity for a hint${who} (${left} left)`); };
    if (left <= 0) {
      btn.disabled = true;
      btn.classList.add('none');
      label('Verity has no hints left for you');
      return;
    }
    idle();
    let armed = false, timer;
    btn.addEventListener('click', function onClick() {
      if (btn.classList.contains('jump')) return;
      if (!armed) {                       // two clicks, so a hint is never spent by accident
        armed = true;
        btn.classList.add('armed');
        label(`Click again to ask Verity${who} (uses 1 hint)`);
        timer = setTimeout(() => { armed = false; idle(); }, 3000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      opts.onReveal && opts.onReveal();
    });
  }

  // Swap the hint button and section to the ones for this view.
  function showScopeHint(paper, p, hintOption, scope) {
    for (const old of paper.querySelectorAll('.p-hint-btn, .p-hint')) old.remove();
    if (!hintOption || !hasScopeHint(p, scope)) return;
    const opts = typeof hintOption === 'function' ? hintOption(scope) : hintOption;
    if (opts) addHint(paper, p, opts, scope);
  }

  // After the hint is open, the corner button jumps to it.
  function showJump(btn, paper) {
    btn.disabled = false;
    btn.classList.remove('armed');
    btn.classList.add('jump');
    btn.innerHTML = VERITY;
    btn.title = "Read Verity's hint";
    btn.setAttribute('aria-label', "Read Verity's hint");
    btn.onclick = () => paper.querySelector('.p-hint')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Called once the hint text has arrived: add the section with a reveal animation and scroll to it.
  // Only acts if the sheet is still on the view the hint belongs to.
  function revealHint(paper, html, scope = 'global') {
    if ((paper.dataset.view || 'global') !== scope) return;
    paper.querySelector('.p-hint')?.remove();
    const sec = hintSection(html, null, scope);
    sec.classList.add('revealing');
    placeHintSection(paper, sec);
    renderMath(sec);
    ThaiDistribute.apply(paper);
    const btn = paper.querySelector('.p-hint-btn');
    if (btn) showJump(btn, paper);
    sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- Thai Distributed justification (like Microsoft Word) ----------
  // Browsers justify by stretching spaces, which leaves big holes in Thai (few spaces).
  // Word's "Thai Distributed" instead spreads the extra room evenly between every character.
  // We split Thai paragraphs into words (Intl.Segmenter), find each line, and give that line
  // just enough letter-spacing to reach the right edge. The last line of a paragraph is left alone.
  const ThaiDistribute = (() => {
    let words = null, graphemes = null;
    try {
      words = new Intl.Segmenter('th', { granularity: 'word' });
      graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
    } catch { /* old browser: plain left alignment */ }

    const BLOCKS = 'p, li, div, blockquote, td, h3, h4';
    const SKIP = '.katex, code, pre, .samples';
    const ATOMS = 'span.tw, span.tws, .katex, code, img';
    const observed = new WeakSet();

    // Text the author aligned left / center / right (toolbar buttons) keeps that alignment;
    // only unaligned or justified text gets Thai Distributed spacing.
    function alignedByAuthor(b) {
      for (let n = b; n && !n.classList?.contains('p-section'); n = n.parentElement) {
        const a = n.style && n.style.textAlign;
        if (a) return a !== 'justify';
      }
      return false;
    }

    function leafBlocks(root) {
      const out = [];
      for (const sec of root.querySelectorAll('.p-section')) {
        for (const b of [sec, ...sec.querySelectorAll(BLOCKS)]) {
          if (b.closest(SKIP) || b.querySelector(BLOCKS) || b.classList.contains('thai-dist') || alignedByAuthor(b)) continue;
          if (THAI.test(b.textContent)) out.push(b);
        }
      }
      return out;
    }

    // Words become <span class="tw"> (kept on one line), each made of character clusters
    // <span class="tc"> (a letter together with its vowel and tone marks, e.g. "กุ๊").
    // Spaces become <span class="tws">. Extra room is added after clusters and spaces,
    // never between a letter and its marks.
    function prepare(block) {
      const align = getComputedStyle(block).textAlign;
      if (/center|right|end/.test(align)) return false;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (!node.nodeValue.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const { segment } of words.segment(node.nodeValue)) {
          if (/^\s+$/.test(segment)) {
            const sp = document.createElement('span');
            sp.className = 'tws';
            sp.textContent = segment;
            frag.appendChild(sp);
            continue;
          }
          const w = document.createElement('span');
          w.className = 'tw';
          for (const { segment: g } of graphemes.segment(segment)) {
            const c = document.createElement('span');
            c.className = 'tc';
            c.textContent = g;
            w.appendChild(c);
          }
          frag.appendChild(w);
        }
        node.replaceWith(frag);
      }
      block.classList.add('thai-dist');
      return true;
    }

    const rectOf = (a) => { const r = a.getBoundingClientRect(); return r.width || r.height ? r : null; };
    const isSpace = (a) => a.classList.contains('tws');

    function lines(block) {
      const out = [];
      for (const a of block.querySelectorAll(ATOMS)) {
        if (a.parentElement.closest('.katex') || (a.matches('code') && a.closest('.katex'))) continue;
        const r = rectOf(a);
        if (!r || !r.width) continue;
        const mid = (r.top + r.bottom) / 2;
        let line = out[out.length - 1];
        if (!line || (!isSpace(a) && Math.abs(mid - line.mid) > Math.max(8, line.h / 2))) {
          if (isSpace(a) && !line) continue;
          line = { mid, h: r.height, atoms: [] };
          out.push(line);
        }
        line.atoms.push(a);
      }
      return out;
    }

    function layout(block) {
      for (const c of block.querySelectorAll('span.tc, span.tws')) c.style.marginRight = '';
      if (block.querySelectorAll('span.tw').length < 2) return;
      const cs = getComputedStyle(block);
      const right = block.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      const maxSpacing = parseFloat(cs.fontSize) * 0.4;
      const brs = [...block.querySelectorAll('br')];
      const ls = lines(block);

      for (let i = 0; i < ls.length - 1; i++) {        // last line stays as it is
        const line = ls[i];
        const real = line.atoms.filter((a) => !isSpace(a));
        if (!real.length) continue;
        const last = real[real.length - 1];
        const nextFirst = ls[i + 1].atoms.find((a) => !isSpace(a));
        if (!nextFirst || line.atoms.some((a) => a.tagName === 'IMG') || nextFirst.tagName === 'IMG') continue;
        // a manual line break (Shift+Enter) ends the line like a paragraph does
        if (brs.some((br) => (last.compareDocumentPosition(br) & 4) && (br.compareDocumentPosition(nextFirst) & 4))) continue;

        // places that receive extra room: every cluster and every space before the line's last item
        const slots = [];
        for (const a of line.atoms) {
          if (a === last) {
            if (a.classList.contains('tw')) slots.push(...[...a.children].slice(0, -1));
            break;
          }
          if (isSpace(a)) slots.push(a);
          else if (a.classList.contains('tw')) slots.push(...a.children);
        }
        if (!slots.length) continue;

        const lineRight = () => Math.max(...real.map((a) => (rectOf(a) || { right: 0 }).right));
        const before = lineRight();
        const extra = right - before - 0.5;
        if (extra <= 0.5) continue;

        let spacing = Math.min(extra / slots.length, maxSpacing);
        const apply = (v) => { for (const s of slots) s.style.marginRight = v ? v + 'px' : ''; };
        apply(spacing);
        const grown = lineRight() - before;
        if (grown > 0.5 && Math.abs(grown - extra) > 0.5 && spacing < maxSpacing) {
          spacing = Math.min(spacing * (extra / grown), maxSpacing);
          apply(spacing);
        }
        // make sure nothing got pushed onto the next line
        for (let tries = 0; tries < 4; tries++) {
          const r = rectOf(last);
          if (r && Math.abs((r.top + r.bottom) / 2 - line.mid) <= Math.max(8, line.h / 2)) break;
          spacing *= 0.9;
          apply(tries === 3 ? 0 : spacing);
        }
      }
    }

    function layoutAll(root) {
      for (const b of root.querySelectorAll('.thai-dist')) layout(b);
    }

    // Measure only after the fonts that change line widths have loaded.
    let fontsLoaded = null;
    function whenFontsReady() {
      if (!document.fonts) return Promise.resolve();
      if (!fontsLoaded) {
        const want = ['400 17px "Thai Formal"', '700 17px "Thai Formal"', 'italic 400 17px "Thai Formal"',
          '400 17px "STIX Two Text"', '700 17px "STIX Two Text"', 'italic 400 17px "STIX Two Text"'];
        fontsLoaded = Promise.all(want.map((f) => document.fonts.load(f, 'กา Aa').catch(() => {})))
          .then(() => document.fonts.ready);
      }
      return fontsLoaded;
    }

    function apply(root) {
      if (!words) return;
      const blocks = leafBlocks(root).filter(prepare);
      for (const b of blocks) layout(b);
      whenFontsReady().then(() => requestAnimationFrame(() => layoutAll(root)));
      if (!observed.has(root)) {
        observed.add(root);
        let timer, lastWidth = 0;
        new ResizeObserver(([entry]) => {
          const w = Math.round(entry.contentRect.width);
          if (w === lastWidth) return;
          lastWidth = w;
          clearTimeout(timer);
          timer = setTimeout(() => layoutAll(root), 60);
        }).observe(root);
        if (document.fonts) document.fonts.addEventListener('loadingdone', () => requestAnimationFrame(() => layoutAll(root)));
      }
    }

    return { apply, layoutAll };
  })();

  window.ProblemView = {
    renderProblem, sanitize, isBlank, authorList, revealHint, parseVideo,
    LEVELS, normalizeLevel, levelName, levelOrder, starsText, levelElement, renderMath,
    relayout: (root) => ThaiDistribute.layoutAll(root),
  };
})();
