const forms = [...document.querySelectorAll('[data-mail]')];

function show(form, code, isError = false) {
  const status = form.querySelector('.form-status');
  status.hidden = false;
  status.dataset.error = String(isError);
  if (code) status.textContent = form.dataset[code];
}

async function enable() {
  for (const form of forms) show(form);
  try {
    const response = await fetch('/api/forms', { signal: AbortSignal.timeout(5000) });
    if (!response.ok || (await response.json()).code !== 'available') throw new Error('Forms unavailable');
  } catch {
    for (const form of forms) show(form, 'disabled');
    return;
  }

  for (const form of forms) {
    const fields = form.querySelector('fieldset');
    form.querySelector('.form-status').hidden = true;
    fields.disabled = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (fields.disabled) return;
      const data = Object.fromEntries(new FormData(form));
      data.lang = document.documentElement.lang;
      data.consent = data.consent === 'on';
      fields.disabled = true;
      show(form, 'sending');
      try {
        const response = await fetch(form.getAttribute('action'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
          signal: AbortSignal.timeout(25000),
        });
        const { code } = await response.json();
        if (response.ok && code === 'sent') {
          form.reset();
          show(form, 'sent');
        } else {
          show(form, ['invalid', 'rate', 'disabled'].includes(code) ? code : 'unavailable', true);
        }
      } catch { show(form, 'unavailable', true); }
      finally { fields.disabled = false; }
    });
  }
}

if (forms.length) enable();
