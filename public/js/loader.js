// Loading screen: the page background colour with a random GIF in the middle.
// The GIFs come from data/gif on the server; drop more .gif files in there and they are
// picked up automatically (never the same one twice in a row).
// Include it in <head>, right after css/theme.css:  <script src="js/loader.js"></script>
(function () {
  const MIN_SHOW_MS = 1200;  // long enough to actually see the GIF
  const GIF_WAIT_MS = 2500;  // don't hold the page back for a slow GIF
  const MAX_SHOW_MS = 8000;  // hard cap, whatever happens
  const FADE_MS = 280;
  const LAST_KEY = 'loader:last';

  const style = document.createElement('style');
  style.textContent = `
    .page-loader {
      position: fixed; inset: 0; z-index: 2147483647;
      display: grid; place-items: center;
      background: var(--bg, #f4f4f1);
      transition: opacity ${FADE_MS}ms ease, visibility 0s linear ${FADE_MS}ms;
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) .page-loader { background: var(--bg, #111113); }
    }
    .page-loader.out { opacity: 0; visibility: hidden; }
    .page-loader img {
      width: min(280px, 70vw); height: min(280px, 50vh); object-fit: contain;
      opacity: 0; transition: opacity 200ms ease;
    }
    .page-loader img.in { opacity: 1; }
    .page-loader img.pixel { image-rendering: pixelated; }
    @media (prefers-reduced-motion: reduce) {
      .page-loader, .page-loader img { transition: none; }
    }`;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.className = 'page-loader';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Loading');
  const img = document.createElement('img');
  img.alt = '';
  el.appendChild(img);
  document.documentElement.appendChild(el);

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const gifSettled = new Promise((settle) => {
    fetch('api/loading-gifs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (!Array.isArray(list) || !list.length) return settle();
        let last = null;
        try { last = sessionStorage.getItem(LAST_KEY); } catch {}
        const pool = list.length > 1 ? list.filter((u) => u !== last) : list;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        try { sessionStorage.setItem(LAST_KEY, pick); } catch {}
        img.onload = () => {
          // small pixel-art GIFs get scaled up, so keep their edges sharp
          if (img.naturalWidth < 140 && img.naturalHeight < 140) img.classList.add('pixel');
          img.classList.add('in');
          settle();
        };
        img.onerror = settle;
        img.src = pick;
      })
      .catch(settle);
  });

  const pageLoaded = new Promise((r) => {
    if (document.readyState === 'complete') r();
    else window.addEventListener('load', r, { once: true });
  });

  let hidden = false;
  function hide() {
    if (hidden) return;
    hidden = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), FADE_MS + 50);
  }

  Promise.race([
    Promise.all([pageLoaded, Promise.race([gifSettled, wait(GIF_WAIT_MS)]), wait(MIN_SHOW_MS)]),
    wait(MAX_SHOW_MS),
  ]).then(hide);

  window.PageLoader = { hide };
})();
