for (const form of document.querySelectorAll('[data-confirm]')) {
  form.addEventListener('submit', (event) => {
    if (!window.confirm('این مقاله و هر دو زبان آن حذف شوند؟')) event.preventDefault();
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
