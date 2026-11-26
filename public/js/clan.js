// The logged-in student and their clan, shared by the map, the editor and the admin page.
// The server decides the clan from the login (data/students.json); this file only shows it.
// The login page saves the student here so pages know the clan straight away; Clan.requireLogin()
// then checks it with the server and sends the browser to the login page when the login has ended
// (logged out, expired, or the same student logged in on another computer).
(function () {
  const KEY = 'me';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const write = (u) => { try { u ? localStorage.setItem(KEY, JSON.stringify(u)) : localStorage.removeItem(KEY); } catch {} };
  let listPromise = null;
  let leaving = false;
  // The mission page can run in a frame over the main page (index.html SubPage): going to the
  // login page must move the whole tab, not just the frame.
  const tab = (() => { try { return window.top.location.href ? window.top : window; } catch { return window; } })();

  function toLogin(why) {
    if (leaving) return;
    leaving = true;
    write(null);
    const here = tab.location.pathname.split('/').pop() + tab.location.search;
    const q = new URLSearchParams();
    if (here && here !== 'index.html') q.set('next', here);
    if (why) q.set('why', why);
    tab.location.replace('login.html' + (q.toString() ? '?' + q : ''));
  }

  window.Clan = {
    // the logged-in student: { username, name, grade, clan } or null
    me: read,
    remember: write,
    id: () => (read() || {}).clan || null,
    headers: () => ({}),   // the login cookie is sent with every request; nothing extra needed
    logo: (id) => `clans/${id}.svg`,
    // the six clans: [{ id, no, name, thai, color }]
    list() {
      listPromise ||= fetch('api/clans').then((r) => r.json()).catch(() => { listPromise = null; return []; });
      return listPromise;
    },
    async info(id = this.id()) { return id ? (await this.list()).find((c) => c.id === id) || null : null; },
    // { clan, score, solved[], progress{}, suites{}, started[], hintsLeft, revealed[], firsts{}, resetAt }
    async state() {
      const r = await fetch('api/clan/state', { cache: 'no-store' });
      const s = await r.json();
      this.checkReset(s.resetAt);
      return s;
    },

    // A page can set Clan.onReset (e.g. the editor reloads so it starts from the starter code).
    onReset: null,
    // The admin reset this clan (resetAt changed since this browser last looked): forget this
    // browser's own copy of code, solved marks, progress and hints. Returns true when it cleared.
    checkReset(resetAt) {
      const clan = this.id();
      if (!clan || !resetAt) return false;
      const key = 'reset-at:' + clan;
      let seen = 0;
      try { seen = Number(localStorage.getItem(key)) || 0; } catch {}
      if (seen === resetAt) return false;
      try {
        const drop = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (/^(code:|solved:|hint:|progress:|suites:)|^hints-left$/.test(k)) drop.push(k);
        }
        for (const k of drop) localStorage.removeItem(k);
        localStorage.setItem(key, String(resetAt));
      } catch {}
      if (typeof this.onReset === 'function') this.onReset();
      return true;
    },

    // For pages only students use (map, problems). Any call the server answers with
    // "log in again" sends the browser to the login page.
    requireLogin() {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const r = await realFetch(...args);
        if (r.status === 401 && r.headers.get('X-Login-Required')) toLogin('ended');
        return r;
      };
      realFetch('api/me', { cache: 'no-store' }).then(async (r) => {
        if (r.status === 401) return toLogin('ended');
        if (!r.ok) return;
        const { user } = await r.json();
        const before = read();
        write(user);
        // someone else logged in on this browser since this page was saved: start over as them
        if (!before || before.username !== user.username || before.clan !== user.clan) location.reload();
      }).catch(() => {});
    },

    async logout() {
      try { await fetch('api/logout', { method: 'POST' }); } catch {}
      write(null);
      leaving = true;
      tab.location.replace('login.html');
    },

    // "ศราวิณญ์ ตันติวรรธณ์ · เอราวัณ" with the clan's color, and a Log out button
    async mountAccount(el) {
      const u = read();
      if (!el || !u) return;
      const c = await this.info(u.clan);
      el.classList.add('account');
      el.textContent = '';
      if (c) el.style.setProperty('--clan', c.color);
      const who = document.createElement('span');
      who.className = 'acc-who';
      who.title = `Logged in as ${u.username}`;
      const name = document.createElement('b');
      name.textContent = u.name;
      who.appendChild(name);
      if (c) {
        const clan = document.createElement('span');
        clan.className = 'acc-clan';
        const logo = document.createElement('img');
        logo.src = this.logo(c.id); logo.alt = '';
        clan.append(logo, c.thai);
        who.appendChild(clan);
      }
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'acc-out';
      out.textContent = 'Log out';
      out.addEventListener('click', () => this.logout());
      el.append(who, out);
    },
  };
})();
