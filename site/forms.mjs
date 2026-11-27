import { icon } from './icons.mjs';

const copy = {
  fa: {
    request: 'درخواست پروژه', requestText: 'نیازتان را توضیح دهید تا تیم اومینی‌کورپ از طریق ایمیل پیگیری کند.',
    name: 'نام', email: 'ایمیل', message: 'شرح پروژه', submitRequest: 'ارسال درخواست',
    newsletter: 'خبرنامه اومینی‌کورپ', newsletterText: 'برای دریافت خبرهای اومینی‌کورپ عضو شوید. عضویت پس از تأیید ایمیل فعال می‌شود.',
    consent: 'با دریافت خبرنامه از طریق ایمیل موافقم و می‌توانم عضویتم را لغو کنم.', subscribe: 'عضویت در خبرنامه',
    sentRequest: 'درخواست به سرور ایمیل تحویل شد. برای پیگیری، ایمیلتان را بررسی کنید.',
    sentSubscription: 'اگر این آدرس قابل ثبت باشد، لینک تأیید را به ایمیلتان می‌فرستیم. پوشهٔ هرزنامه را هم ببینید.',
    loading: 'در حال بررسی دسترسی به فرم…', sending: 'در حال ارسال…',
    disabled: 'این فرم در این نسخه فعال نیست. برای تماس از راه‌های بالا استفاده کنید.',
    invalid: 'اطلاعات فرم را بررسی کنید و دوباره بفرستید.', rate: 'تعداد درخواست‌ها زیاد است. چند دقیقه دیگر دوباره تلاش کنید.',
    unavailable: 'ارسال ممکن نشد. کمی بعد دوباره تلاش کنید یا مستقیم تماس بگیرید.',
    nojs: 'برای استفاده از فرم، جاوااسکریپت را فعال کنید. راه‌های تماس مستقیم بالای این بخش قرار دارند.',
  },
  en: {
    request: 'Project request', requestText: 'Tell us what you’re working on and the OminiCorp team can follow up by email.',
    name: 'Name', email: 'Email', message: 'Project brief', submitRequest: 'Send request',
    newsletter: 'OminiCorp newsletter', newsletterText: 'Sign up for OminiCorp updates. Your subscription starts once you confirm your email.',
    consent: 'I agree to receive email updates and understand that I can unsubscribe.', subscribe: 'Subscribe',
    sentRequest: 'Your request was accepted by our mail server. Check your email for a reply.',
    sentSubscription: 'If this address can be registered, we’ll send a confirmation link. Check your spam folder too.',
    loading: 'Checking form availability…', sending: 'Sending…',
    disabled: 'This form is not active here. You can still contact us using the links above.',
    invalid: 'Check the form and try again.', rate: 'Too many attempts. Please try again in a few minutes.',
    unavailable: 'Could not send. Please try again later or contact us directly.',
    nojs: 'Enable JavaScript to use the form, or use the direct contact links above.',
  },
};

export function renderForms(lang) {
  const t = copy[lang];
  const email = (kind) => `<label for="${kind}-email">${t.email}<input id="${kind}-email" type="email" name="email" autocomplete="email" dir="ltr" maxlength="254" required></label>`;
  const messages = { sending: t.sending, disabled: t.disabled, invalid: t.invalid, rate: t.rate, unavailable: t.unavailable };
  const form = (kind, title, lead, mark, sent, fields, button) => `<section class="mail-card" aria-labelledby="${kind}-title">
  <span class="tile">${icon(mark)}</span><h3 id="${kind}-title">${title}</h3><p>${lead}</p>
  <form method="post" action="/api/${kind}" data-mail="${kind}" ${Object.entries({ ...messages, sent }).map(([key, value]) => `data-${key}="${value}"`).join(' ')}>
    <fieldset disabled>
      ${fields}
      <input name="website" type="text" autocomplete="off" tabindex="-1" hidden aria-label="${lang === 'fa' ? 'این فیلد را خالی بگذارید' : 'Leave this field empty'}">
      <button class="button button-primary" type="submit">${button}${icon('arrow', 'directional')}</button>
    </fieldset>
    <p class="form-status" role="status" data-loading hidden>${t.loading}</p><noscript><p>${t.nojs}</p></noscript>
  </form>
</section>`;
  return `<div class="mail-grid">
  ${form('request', t.request, t.requestText, 'telegram', t.sentRequest, `<div class="field-row"><label for="request-name">${t.name}<input id="request-name" name="name" maxlength="100" autocomplete="name" required></label>${email('request')}</div><label for="request-message">${t.message}<textarea id="request-message" name="message" rows="4" minlength="10" maxlength="3000" required></textarea></label>`, t.submitRequest)}
  ${form('subscribe', t.newsletter, t.newsletterText, 'spark', t.sentSubscription, `${email('subscribe')}<label class="consent" for="subscribe-consent"><input id="subscribe-consent" type="checkbox" name="consent" required><span>${t.consent}</span></label>`, t.subscribe)}
</div>`;
}
