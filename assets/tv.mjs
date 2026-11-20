import { moveSlide } from './service-guide.mjs';

const SLIDE_DURATION = 9000;

export function activateDisplay(services) {
  const display = document.querySelector('#display');
  const slide = display.querySelector('.slide');
  const decoration = display.querySelector('.tv-icon');
  const progress = display.querySelector('.tv-progress');
  const play = display.querySelector('[data-play]');
  const full = display.querySelector('[data-fullscreen]');
  const fullLabel = full.lastChild;
  const status = display.querySelector('[data-full-status]');
  let current = 0;
  let playing = false;
  let timer;
  let wakeLock;
  let wakePending = false;

  function show(offset = 0) {
    current = moveSlide(current, offset, services.length);
    const { id, title, paragraphs, icon } = services[current];
    const label = document.createElement('span');
    label.className = 'tv-chapter';
    label.dir = 'ltr';
    label.textContent = `OC / ${String(current + 1).padStart(2, '0')} — ${String(services.length).padStart(2, '0')}`;
    const heading = document.createElement('h3');
    heading.textContent = title;
    const content = document.createElement('div');
    content.className = 'tv-copy';
    content.append(label, heading, ...paragraphs.map((node) => node.cloneNode(true)));
    display.dataset.scene = id;
    slide.replaceChildren(content);
    decoration.replaceChildren(icon.cloneNode(true));
    progress.replaceChildren(document.createElement('span'));
  }

  function schedule() {
    clearTimeout(timer);
    const active = playing && display.open && !document.hidden;
    display.classList.toggle('is-playing', active);
    if (active) timer = setTimeout(() => { show(1); schedule(); }, SLIDE_DURATION);
  }

  function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = undefined;
    lock?.release().catch(() => {});
  }

  async function keepAwake() {
    if (!navigator.wakeLock || !playing || !display.open || document.hidden || wakeLock || wakePending) return;
    wakePending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!playing || !display.open || document.hidden) return await lock.release();
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = undefined; });
    } catch { /* Browser or OS may reject wake lock; playback still works. */ }
    finally { wakePending = false; }
  }

  function setPlaying(value) {
    playing = value;
    slide.setAttribute('aria-live', playing ? 'off' : 'polite');
    play.textContent = playing ? play.dataset.pause : play.dataset.play;
    schedule();
    if (playing) keepAwake(); else releaseWakeLock();
  }

  function change(offset) {
    setPlaying(false);
    show(offset);
  }

  display.querySelectorAll('[data-slide]').forEach((button) => {
    button.addEventListener('click', () => change(Number(button.dataset.slide)));
  });
  play.addEventListener('click', () => setPlaying(!playing));
  full.addEventListener('click', async () => {
    try {
      status.textContent = '';
      if (document.fullscreenElement === display) await document.exitFullscreen();
      else await display.requestFullscreen();
    } catch { status.classList.remove('sr-only'); status.textContent = full.dataset.error; }
  });
  document.addEventListener('fullscreenchange', () => {
    fullLabel.textContent = document.fullscreenElement === display ? full.dataset.exit : full.dataset.fullscreen;
  });
  display.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const forward = document.documentElement.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    change(event.key === forward ? 1 : -1);
  });
  display.addEventListener('close', () => {
    setPlaying(false);
    if (document.fullscreenElement === display) document.exitFullscreen().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseWakeLock(); schedule(); }
    else if (playing && display.open) { show(); schedule(); keepAwake(); }
  });
  show();
  const params = new URLSearchParams(location.search);
  if (params.get('tv') === '1') {
    display.showModal();
    setPlaying(true);
  }
}
