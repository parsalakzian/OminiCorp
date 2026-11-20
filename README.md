# OminiCorp — وب‌سایت معرفی خدمات

صفحهٔ فارسی در `/` و انگلیسی در `/en.html`. کاتالوگ، راهنمای انتخاب، نمایشگر دفتر و تماس مستقیم. بدون پایگاه‌داده، حساب، فرم ارسال، سرویس تحلیل یا CDN. لینک‌های تماس فقط با انتخاب کاربر به سرویس خودشان می‌روند و برای آن مرحله ممکن است اینترنت یا برنامهٔ مربوط لازم باشد.

## اجرا با Docker Compose

بعد از انتشار تگ `latest` در GHCR، با Docker و افزونهٔ Compose:

```sh
docker compose up -d --wait
```

سایت: `http://localhost:8080`؛ وضعیت: `http://localhost:8080/healthz`. تا انتشار نسخهٔ اصلی، برای تگ شاخهٔ تحویل پس از موفقیت گردش‌کار:

```sh
OMINICORP_IMAGE=ghcr.io/parsalakzian/ominicorp:preview docker compose up -d --wait
```

| متغیر (اختیاری) | پیش‌فرض | کاربرد |
|---|---|---|
| `OMINICORP_IMAGE` | `ghcr.io/parsalakzian/ominicorp:latest` | انتخاب تگ انتشار، تگ `sha-<commit>` یا نسخهٔ ثابت با digest |
| `OMINICORP_PORT` | `8080` | پورت روی میزبان |
| `OMINICORP_BIND` | `127.0.0.1` | دسترسی محلی به‌صورت پیش‌فرض؛ برای دسترسی مستقیم شبکه `0.0.0.0` |

برای استقرار عمومی، ترجیحاً مقدار پیش‌فرض `127.0.0.1` را نگه دارید و TLS را در reverse proxy میزبان فعال کنید. تنظیمات اختیاری را می‌توان در `.env` محلی قرار داد. اگر بستهٔ GHCR خصوصی است، میزبان باید از قبل در رجیستری احراز هویت شده باشد؛ مالک می‌تواند در Package Settings آن را عمومی کند تا pull بدون ورود انجام شود.

### اجرا بدون دانلود

هیچ بسته‌ای هنگام اجرای کانتینر نصب نمی‌شود و همهٔ دارایی‌های صفحه در ایمیج هستند. روی میزبان کاملاً آفلاین، یک بار ایمیج متناسب با معماری میزبان را در دستگاه متصل دریافت و منتقل کنید (برای ARM64، پلتفرم را متناسب با مقصد تغییر دهید):

```sh
# روی دستگاه متصل؛ برای نسخهٔ پیش‌نمایش به‌جای latest از preview استفاده کنید.
IMAGE=ghcr.io/parsalakzian/ominicorp:latest
docker pull --platform linux/amd64 "$IMAGE"
docker save -o ominicorp.tar "$IMAGE"

# روی دستگاه آفلاین، پس از انتقال فایل و compose.yaml:
docker load -i ominicorp.tar
docker compose up -d --pull never --wait
```

اگر فایل منتقل‌شده تگ پیش‌نمایش دارد، در خط آخر `OMINICORP_IMAGE` را روی همان تگ تنظیم کنید. برای ساخت از سورس، `docker build --network=none -t ominicorp:local .` و سپس `OMINICORP_IMAGE=ominicorp:local docker compose up -d --pull never --wait` را اجرا کنید. `--network=none` برای مراحل ساخت است؛ در اولین ساخت، ایمیج پایه باید از قبل موجود باشد یا از رجیستری دریافت شود.

## توسعه و تست

```sh
npm run dev                  # Node.js 22+؛ http://localhost:4173
npm run build                # بعد از تغییر محتوا یا قالب؛ هر دو HTML را بازسازی کنید
npm test                     # خروجی، منطق اصلی و بررسی محلی بودن فایل‌ها
npm ci                       # تنها برای تست مرورگر
npx playwright install chromium
npm run test:browser
```

برای تغییر پورت پیش‌نمایش `PORT=4174 npm run dev`. متن‌ها در `site/content.mjs`، قالب در `site/render.mjs`، استایل در `assets/site.css` و رفتار رابط در `assets/site.mjs` هستند. ساختار کامل و علت انتخاب معماری در [سند معماری](docs/architecture.md) آمده است. فونت‌های Vazirmatn و Space Grotesk از Fontsource نسخهٔ `5.3.0`، در کنار مجوزهایشان در `assets/fonts/` نگهداری می‌شوند. لوگو از فایل ارسالی برند استخراج شده و تصویر بخش اول یک تصویرسازی اختصاصی است.

## انتشار، به‌روزرسانی و بازگشت

گردش‌کار `.github/workflows/publish.yml` تست منطق، تست مرورگر Chromium و smoke test واقعی Compose را اجرا می‌کند. فقط پس از موفقیت تست‌ها، برای `main` تگ `latest` و برای شاخهٔ تحویل تگ `preview` می‌سازد؛ هر دو تگ نسخهٔ `sha-<commit>` هم دارند. معماری‌های خروجی `linux/amd64` و `linux/arm64` هستند؛ تست اجرای کانتینر روی runner از نوع AMD64 است. نوشتن در بسته از طریق `GITHUB_TOKEN` خود Actions انجام می‌شود، نه با قراردادن کلید در کد. تریگر پیش‌نمایش را بعد از تحویل می‌توان از گردش‌کار حذف کرد.

برای به‌روزرسانی `docker compose pull && docker compose up -d --wait`. برای بازگشت، `OMINICORP_IMAGE` را روی SHA یا digest نسخهٔ قبلی تنظیم و دوباره Compose را اجرا کنید. برای مشاهدهٔ لاگ‌ها `docker compose logs -f website`. دادهٔ قابل پشتیبان‌گیری وجود ندارد؛ Git، نسخهٔ ایمیج و تنظیمات reverse proxy را نگه دارید. مسیرهای قدیمی `omixy` و `*.text` در مخزن و میزبانی فعلی دست‌نخورده‌ هستند و عمداً داخل کانتینر وب کپی نمی‌شوند.
