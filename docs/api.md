# قرارداد HTTP فرم‌ها

رابط فقط روی سرور Node/کانتینر و از همان مبدأ کار می‌کند. دادهٔ فرم‌های JSON حداکثر ۱۶٬۰۰۰ بایت است. پاسخ‌ها cache نمی‌شوند و اطلاعات شخصی یا جزئیات SMTP را برنمی‌گردانند.

| روش و مسیر | ورودی | نتیجه |
|---|---|---|
| `GET /healthz` | — | `200` یعنی وب‌سرور پاسخ می‌دهد؛ SMTP و حجم داده سنجیده نمی‌شوند. |
| `GET /api/forms` | — | `200 {"code":"available"}` یا `200 {"code":"disabled"}` |
| `POST /api/request` | JSON: `name` تا ۱۰۰ نویسه، `email` معتبر، `message` بین ۱۰ تا ۳۰۰۰ نویسه | `202 {"code":"sent"}` پس از پذیرش SMTP |
| `POST /api/subscribe` | JSON: `email` معتبر، `consent: true` و `lang` برابر `fa` یا `en` | `202 {"code":"sent"}` برای ایمیل تأیید یا درخواست تکراری، بدون افشای وضعیت عضویت |
| `GET /opt-in`, `GET /opt-out` | query: `token` و در صورت نیاز `lang` | صفحهٔ تأیید؛ GET هیچ تغییری نمی‌دهد. |
| `POST /opt-in`, `POST /opt-out` | فرم URL-encoded با `token`، زبان از query | صفحهٔ HTML موفقیت یا خطای توکن نامعتبر/منقضی |

خطاهای POST JSON: `400/403/413/415` با `invalid`، `429` با `rate` و `Retry-After` و `503` با `disabled` یا `unavailable`. درخواست‌های cross-origin پذیرفته نمی‌شوند. راه دسترسی HTTP به فهرست مشترکان وجود ندارد؛ خروجی فقط از CLI داخل کانتینر است. لینکی که ایمیل می‌شود بر اساس `PUBLIC_SITE_URL` ساخته می‌شود، نه هدر Host درخواست.
