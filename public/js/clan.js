// Which clan this browser plays for, shared by the map, the editor and the admin page.
// For now it is set by the admin's "Play as" button and kept in this browser;
// later the player roster will decide it (the server reads it in clans.js -> clanOf()).
(function () {
  const KEY = 'clan';
  const get = () => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };
  let listPromise = null;

  window.Clan = {
    id: get,
    set(id) { try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY); } catch {} },
    // add to every fetch that should count for the clan
    headers() { const id = get(); return id ? { 'X-Clan': id } : {}; },
    logo: (id) => `clans/${id}.svg`,
    // the six clans: [{ id, no, name, thai, color }]
    list() {
      listPromise ||= fetch('api/clans').then((r) => r.json()).catch(() => { listPromise = null; return []; });
      return listPromise;
    },
    async info(id = get()) { return id ? (await this.list()).find((c) => c.id === id) || null : null; },
    // { clan, score, solved[], progress{}, started[], hintsLeft, revealed[], firsts{} }
    async state() {
      const r = await fetch('api/clan/state', { headers: this.headers(), cache: 'no-store' });
      return r.json();
    },
  };
})();
