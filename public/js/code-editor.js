// CodeMirror setup: pastel theme, VS Code shortcuts, smooth caret, selection animation.
(function () {
  function modeFor(lang) { return lang === 'cpp' ? 'text/x-c++src' : 'text/x-csrc'; }

  function addVsCodeCommands() {
    const Pos = CodeMirror.Pos;
    CodeMirror.commands.copyLinesUp = (cm) => {
      const ranges = cm.listSelections();
      cm.operation(() => {
        for (let i = ranges.length - 1; i >= 0; i--) {
          const r = ranges[i];
          const from = Math.min(r.anchor.line, r.head.line), to = Math.max(r.anchor.line, r.head.line);
          cm.replaceRange(cm.getRange(Pos(from, 0), Pos(to)) + '\n', Pos(from, 0));
        }
        cm.setSelections(ranges);
      });
    };
    CodeMirror.commands.copyLinesDown = (cm) => {
      const ranges = cm.listSelections();
      cm.operation(() => {
        for (let i = ranges.length - 1; i >= 0; i--) {
          const r = ranges[i];
          const from = Math.min(r.anchor.line, r.head.line), to = Math.max(r.anchor.line, r.head.line);
          cm.replaceRange('\n' + cm.getRange(Pos(from, 0), Pos(to)), Pos(to));
        }
        const n = (r) => Math.abs(r.head.line - r.anchor.line) + 1;
        cm.setSelections(ranges.map((r) => ({
          anchor: Pos(r.anchor.line + n(r), r.anchor.ch), head: Pos(r.head.line + n(r), r.head.ch),
        })));
      });
    };
    CodeMirror.commands.selectAllOccurrences = (cm) => {
      let text = cm.getSelection();
      if (!text) { const w = cm.findWordAt(cm.getCursor()); text = cm.getRange(w.anchor, w.head); }
      if (!text.trim() || !cm.getSearchCursor) return;
      const sels = [];
      const cur = cm.getSearchCursor(text, Pos(cm.firstLine(), 0));
      while (cur.findNext()) sels.push({ anchor: cur.from(), head: cur.to() });
      if (sels.length) cm.setSelections(sels);
    };
  }

  /* Smooth caret: glides between positions, pops when you type, fades when idle */
  function setupSmoothCaret(editor) {
    const wrapper = editor.getWrapperElement();
    const space = (editor.display && editor.display.lineSpace) || wrapper.querySelector('.CodeMirror-lines > div');
    if (!space) return;
    const caret = document.createElement('div');
    caret.className = 'smooth-caret';
    caret.innerHTML = '<span class="blink on"><span class="bar"></span></span>';
    const blink = caret.firstChild, bar = blink.firstChild;
    space.appendChild(caret);
    wrapper.classList.add('has-smooth-caret');

    const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
    function place(animate) {
      wrapper.classList.toggle('multi-cursor', editor.listSelections().length > 1);
      const c = editor.cursorCoords(editor.getCursor('head'), 'window');
      const base = space.getBoundingClientRect();
      if (!animate) caret.style.transition = 'none';
      caret.style.transform = `translate(${c.left - base.left - 1}px, ${c.top - base.top}px)`;
      caret.style.height = (c.bottom - c.top) + 'px';
      if (!animate) { void caret.offsetWidth; caret.style.transition = ''; }
      restart(blink, 'on');
    }
    editor.on('cursorActivity', () => place(true));
    editor.on('inputRead', () => restart(bar, 'pop'));
    editor.on('keyHandled', (cm, name) => { if (/Backspace|Delete/.test(name)) restart(bar, 'pop'); });
    editor.on('focus', () => place(false));
    editor.on('refresh', () => place(false));
    editor.on('viewportChange', () => place(false));
    window.addEventListener('resize', () => place(false));
    place(false);
  }

  function setupSelectionAnimation(editor) {
    const wrapper = editor.getWrapperElement();
    let had = false, timer;
    editor.on('cursorActivity', () => {
      const has = editor.somethingSelected();
      if (has && !had) {
        wrapper.classList.add('sel-anim');
        clearTimeout(timer);
        timer = setTimeout(() => wrapper.classList.remove('sel-anim'), 250);
      }
      had = has;
    });
  }

  /**
   * Turn a <textarea> into the code editor.
   * Returns { getValue, setValue, setLang, focus, refresh } so the page works with or without CodeMirror.
   */
  function createCodeEditor(textarea, { lang = 'c', onRun = () => {}, onChange = () => {} } = {}) {
    if (!window.CodeMirror) {
      // Fallback: plain textarea if the editor library could not load
      textarea.addEventListener('input', () => onChange(textarea.value));
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
      });
      return {
        getValue: () => textarea.value,
        setValue: (v) => { textarea.value = v; },
        setLang() {}, focus: () => textarea.focus(), refresh() {},
      };
    }

    addVsCodeCommands();
    const has = (name) => typeof CodeMirror.commands[name] === 'function';
    const keys = {
      'Ctrl-Enter': () => onRun(), 'Cmd-Enter': () => onRun(), 'F5': () => onRun(),
      'Alt-Up': 'swapLineUp', 'Alt-Down': 'swapLineDown',
      'Shift-Alt-Up': 'copyLinesUp', 'Shift-Alt-Down': 'copyLinesDown',
      'Shift-Ctrl-K': 'deleteLine',
      'Ctrl-/': has('toggleCommentIndented') ? 'toggleCommentIndented' : 'toggleComment',
      'Shift-Ctrl-L': 'selectAllOccurrences',
      'Ctrl-]': 'indentMore', 'Ctrl-[': 'indentLess',
      'Shift-Ctrl-\\': 'goToBracket',
      Tab: (cm) => cm.execCommand(cm.somethingSelected() ? 'indentMore' : 'insertSoftTab'),
      'Shift-Tab': 'indentLess',
    };
    for (const [k, v] of Object.entries(keys)) if (typeof v === 'string' && !has(v)) delete keys[k];

    const cm = CodeMirror.fromTextArea(textarea, {
      mode: modeFor(lang),
      theme: 'pastel',
      keyMap: CodeMirror.keyMap.sublime ? 'sublime' : 'default',
      extraKeys: CodeMirror.normalizeKeyMap(keys),
      lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
      matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
      highlightSelectionMatches: { minChars: 2, showToken: false, delay: 80 },
      cursorBlinkRate: 0,
      configureMouse: (cm, repeat, e) => ({
        addNew: e.altKey && !e.shiftKey,
        unit: e.altKey && e.shiftKey ? 'rectangle' : repeat === 'single' ? 'char' : repeat === 'double' ? 'word' : 'line',
      }),
    });
    cm.addOverlay({
      token(stream) {
        if (stream.match(/^[A-Za-z_]\w*(?=\s*\()/)) return 'fncall';
        if (stream.match(/^[A-Za-z_]\w*/)) return null;
        stream.next();
        return null;
      },
    });
    let silent = false;
    cm.on('change', () => { if (!silent) onChange(cm.getValue()); });
    setupSmoothCaret(cm);
    setupSelectionAnimation(cm);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => cm.refresh());

    return {
      cm,
      getValue: () => cm.getValue(),
      setValue: (v) => { silent = true; cm.setValue(v); cm.clearHistory(); silent = false; },
      setLang: (l) => cm.setOption('mode', modeFor(l)),
      focus: () => cm.focus(),
      refresh: () => cm.refresh(),
    };
  }

  window.createCodeEditor = createCodeEditor;
})();
