for (const form of document.querySelectorAll('[data-confirm]')) {
  form.addEventListener('submit', (event) => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const form of document.querySelectorAll('[data-generate]')) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const output = form.querySelector('output');
    const button = form.querySelector('button');
    const body = new URLSearchParams(new FormData(form));
    button.disabled = true;
    output.textContent = 'در حال بررسی منابع و ساخت پیش‌نویس…';
    try {
      const result = await fetch(form.action, { method: 'POST', body, redirect: 'manual' });
      if (result.type !== 'opaqueredirect') throw new Error('Generation unavailable');
      for (let i = 0; i < 165; i++) {
        const response = await fetch('/admin/run', { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('Status unavailable');
        const status = await response.json();
        if (!status.pending) { window.location.assign('/admin'); return; }
        await delay(2200);
      }
      output.textContent = 'اجرا همچنان ادامه دارد. نتیجه در نمای کلی ثبت خواهد شد.';
    } catch { output.textContent = 'عملیات کامل نشد؛ اتصال یا ورود به پنل را بررسی کنید.'; }
    finally { button.disabled = false; }
  });
}

const revealedToken = document.querySelector('[data-mcp-reveal]');
if (revealedToken) {
  const input = revealedToken.querySelector('[data-mcp-token]');
  const button = revealedToken.querySelector('[data-copy-mcp]');
  const status = revealedToken.querySelector('[data-mcp-copy-status]');
  if (navigator.clipboard) {
    button.hidden = false;
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(input.value); status.textContent = 'توکن کپی شد.'; }
      catch { input.focus(); input.select(); status.textContent = 'توکن انتخاب شد؛ آن را دستی کپی کنید.'; }
    });
  }
  window.addEventListener('pagehide', () => { input.value = ''; input.defaultValue = ''; revealedToken.hidden = true; });
}

const coverInput = document.querySelector('[name="cover.src"]');
const coverPreview = document.querySelector('[data-cover-preview]');
function updateCover() {
  const value = coverInput.value.trim();
  const local = /^\/journal-media\/([a-f0-9]{64})$/.exec(value);
  let src = '/assets/media/blog.webp';
  if (local) src = `/admin/media/${local[1]}`;
  else if (value.startsWith('https://')) {
    try { const url = new URL(value); if (!url.username && !url.password) src = url.href; } catch { /* keep fallback */ }
  }
  coverPreview.src = src;
  coverPreview.hidden = false;
}
coverInput?.addEventListener('change', updateCover);
coverPreview?.addEventListener('error', () => { coverPreview.hidden = true; });
for (const widget of document.querySelectorAll('[data-image-upload]')) {
  widget.hidden = false;
  const scope = widget.closest('[data-article-editor], [data-media-library]');
  const csrf = scope.querySelector('[name="csrf"]').value;
  const file = widget.querySelector('[type="file"]');
  const button = widget.querySelector('button');
  const output = widget.querySelector('output');
  button.addEventListener('click', async () => {
    const selected = file.files[0];
    if (!selected) { output.textContent = 'ابتدا یک فایل انتخاب کنید.'; return; }
    if (selected.size > 3 * 1024 * 1024) { output.textContent = 'اندازهٔ تصویر نباید از ۳ مگابایت بیشتر باشد.'; return; }
    button.disabled = true;
    output.textContent = 'در حال بارگذاری…';
    try {
      const response = await fetch('/admin/media', { method: 'POST', body: selected, redirect: 'error',
        headers: { 'Content-Type': selected.type || 'application/octet-stream', 'X-CSRF-Token': csrf }, signal: AbortSignal.timeout(25000) });
      if (!response.ok) {
        output.textContent = response.status === 507 ? 'فضای کتابخانه پر شده است. تصاویر بدون استفاده را حذف کنید.' : response.status === 403 ? 'دسترسی رد شد. دوباره وارد پنل شوید.' : 'فایل پذیرفته نشد. قالب و اندازهٔ تصویر را بررسی کنید.';
        return;
      }
      const { url } = await response.json();
      const target = widget.dataset.imageUpload;
      if (target === 'library') { window.location.assign('/admin/media?notice=imageUploaded'); return; }
      const input = scope.elements.namedItem(target);
      if (target === 'cover.src') { input.value = url; updateCover(); }
      else {
        const raw = widget.querySelector('[data-inline-alt]').value;
        const alt = raw.replace(/[\\\[\]]/g, '\\$&');
        input.setRangeText(`\n\n![${alt}](${url})\n\n`, input.selectionStart, input.selectionEnd, 'end');
        input.focus();
      }
      file.value = '';
      output.textContent = 'تصویر اضافه شد. تغییرات مقاله را ذخیره کنید.';
    } catch { output.textContent = 'بارگذاری کامل نشد؛ اتصال و ورود به پنل را بررسی کنید.'; }
    finally { button.disabled = false; }
  });
}
for (const button of document.querySelectorAll('[data-copy-image]')) {
  button.addEventListener('click', async () => {
    const input = button.closest('article').querySelector('input[readonly]');
    try { await navigator.clipboard.writeText(input.value); button.textContent = 'کپی شد'; }
    catch { input.focus(); input.select(); }
  });
}
