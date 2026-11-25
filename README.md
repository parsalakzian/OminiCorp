# OminiCorp — وب‌سایت معرفی خدمات

صفحهٔ فارسی در `/` و انگلیسی در `/en.html`. کاتالوگ، راهنمای انتخاب، نمایشگر دفتر، تماس مستقیم، فرم درخواست پروژه و عضویت خبرنامه. فونت‌ها، تصویر، استایل و اسکریپت‌ها محلی‌اند. لینک‌های تماس فقط پس از انتخاب کاربر به سرویس خارجی می‌روند.


وبلاگ فارسی `/blog` و انگلیسی `/en/blog`؛ پنل `/admin`. تنظیم `blog.env`، سئو، RSS/Atom، AI با پراکسی، زمان‌بندی و MCP در [راهنمای وبلاگ](docs/blog.md) آمده‌اند. Pages فقط مقاله‌های آغازین را ارائه می‌دهد و قابلیت‌های پویا روی کانتینر فعال می‌شوند.

## راه‌اندازی

با Docker و افزونهٔ Compose نسخهٔ ۲٫۳۰ یا بالاتر:

```sh
docker compose up -d --wait
```

سایت `http://localhost:8080` و سلامت وب‌سرور `http://localhost:8080/healthz`. برای آزمایش تگ شاخهٔ تحویل از `OMINICORP_IMAGE=ghcr.io/parsalakzian/ominicorp:preview` استفاده کنید. برای استقرار عمومی، اتصال پیش‌فرض به `127.0.0.1` را نگه دارید و HTTPS را روی reverse proxy فعال کنید. اگر بستهٔ GHCR خصوصی است، میزبان باید از قبل به آن دسترسی داشته باشد.

| متغیر اختیاری Compose | پیش‌فرض | کاربرد |
|---|---|---|
| `OMINICORP_IMAGE` | `ghcr.io/parsalakzian/ominicorp:latest` | انتخاب تگ انتشار، `sha-<commit>` یا digest |
| `OMINICORP_PORT` | `8080` | پورت روی میزبان |
| `OMINICORP_BIND` | `127.0.0.1` | برای دسترسی مستقیم شبکه `0.0.0.0` |

### فعال‌سازی فرم‌ها و SMTP

```sh
cp smtp.env.example smtp.env
chmod 600 smtp.env
# smtp.env را روی همان میزبان با تنظیمات سرویس ایمیل پر کنید.
docker compose up -d --wait
```

| تنظیم | مقدار و توضیح |
|---|---|
| `SMTP_HOST` | میزبان SMTP؛ اگر خالی باشد فقط فرم‌ها غیرفعال می‌شوند |
| `SMTP_SECURITY`, `SMTP_PORT` | `starttls` و `587`، یا `tls` و `465` برای TLS مستقیم؛ `none` فقط بدون احراز هویت روی loopback برای تست محلی |
| `SMTP_USER`, `SMTP_PASS` | نام کاربری و رمز SMTP، در صورت نیاز هر دو را تنظیم کنید؛ `smtp.env` را داخل Git نگذارید |
| `SMTP_FROM`, `SMTP_TO` | فرستندهٔ مجاز روی سرویس SMTP و صندوق تیم برای درخواست‌های پروژه |
| `PUBLIC_SITE_URL` | مبدأ HTTPS که همان کانتینر را ارائه می‌کند، مانند `https://ominicorp.com`؛ در تست محلی `http://localhost:8080` هم مجاز است |

فرم پروژه ایمیل را به `SMTP_TO` می‌فرستد و `Reply-To` را روی ایمیل کاربر می‌گذارد؛ متن درخواست در سرور سایت ذخیره نمی‌شود. «ارسال شد» یعنی SMTP دریافت را پذیرفته، نه تضمین رسیدن ایمیل به Inbox. از فرستندهٔ تأییدشدهٔ سرویس و تنظیمات SPF/DKIM سرویس استفاده کنید.

خبرنامه بعد از رضایت کاربر، لینک تأیید ۴۸ساعته و لینک لغو می‌فرستد. برای فهرست **فقط اعضای تأییدشده**:

```sh
(umask 077; docker compose exec -T website node server/export.mjs > subscribers.txt)
```

ارسال کمپین گروهی یا پنل مدیریت جزو این نسخه نیست. برای کمپین‌ها از سرویس ارسال خبرنامه با مدیریت لغو عضویت استفاده کنید و خروجی را محرمانه نگه دارید. محدودیت ارسال درون فرایند براساس آی‌پی سوکت است، به هدرهای ارسالی اعتماد نمی‌کند و پشت یک پراکسی همهٔ کاربران ممکن است یک سهمیهٔ مشترک داشته باشند. در استقرار پرترافیک، محدودیت‌های لبه را در reverse proxy تنظیم کنید. query string مسیرهای `/opt-in` و `/opt-out` نباید در لاگ پراکسی ذخیره شود.

**GitHub Pages استاتیک است**؛ صفحات و TV در آن کار می‌کنند، اما فرم‌ها فقط روی نسخهٔ Docker یا همان سرور Node فعال می‌شوند. اگر دامنه هنوز به Pages اشاره می‌کند، برای فعال‌کردن فرم‌ها آن را به reverse proxy کانتینر منتقل کنید. `/healthz` سلامت HTTP را بررسی می‌کند، نه اتصال SMTP؛ پس از تنظیم، یک درخواست و یک عضویت آزمایشی با ایمیل خودتان ارسال کنید.

### نمایشگر تلویزیون

روی تلویزیون `/?tv=1` را در فارسی یا `/en.html?tv=1` را در انگلیسی باز کنید. پخش خودکار بعد از بازکردن لینک شروع می‌شود. با دکمهٔ «تمام‌صفحه» از مرورگر وارد تمام‌صفحه شوید. کلیدهای جهت‌نما اسلاید را عوض و پخش خودکار را متوقف می‌کنند. اگر مرورگر مجاز بداند، هنگام پخش درخواست Screen Wake Lock می‌شود؛ برای نصب دائمی، تنظیمات خاموش‌شدن و حالت kiosk دستگاه را هم بررسی کنید. در مرورگرهای با گزینهٔ کاهش حرکت، انیمیشن‌ها خاموش می‌شوند و عوض‌شدن اسلاید ادامه دارد.

### اجرا بدون دانلود

پس از دریافت ایمیج، کانتینر هیچ وابستگی نصب نمی‌کند. روی میزبان آفلاین فقط SMTP از کار می‌افتد، مگر اینکه سرور ایمیل از شبکهٔ داخلی در دسترس باشد. برای انتقال آفلاین، نوع پلتفرم AMD64 یا ARM64 را متناسب با مقصد انتخاب کنید:

```sh
IMAGE=ghcr.io/parsalakzian/ominicorp:latest
docker pull --platform linux/amd64 "$IMAGE"
docker save -o ominicorp.tar "$IMAGE"
# روی مقصد، پس از انتقال فایل و compose.yaml:
docker load -i ominicorp.tar
docker compose up -d --pull never --wait
```

در ساخت نخست از سورس، مرحلهٔ build برای دریافت تصویر پایه و وابستگی‌های وب‌سرور به رجیستری‌ها نیاز دارد: `docker build -t ominicorp:local .` و سپس `OMINICORP_IMAGE=ominicorp:local docker compose up -d --pull never --wait`.

## توسعه، تست و انتشار

```sh
npm ci                         # Node.js 24 پیشنهاد می‌شود
npm run dev                    # http://localhost:4173
npm run build                  # بازسازی هر دو HTML پس از تغییر منبع
npm test
npx playwright install chromium
npm run test:browser
```

برای توسعه با فایل محیطی: `node --env-file=smtp.env server/start.mjs`. ساختار پروژه در [سند معماری](docs/architecture.md) و قرارداد فرم‌ها در [مستند API](docs/api.md) است. فونت‌های Vazirmatn و Space Grotesk از Fontsource نسخهٔ `5.3.0` با مجوزهای مربوط در `assets/fonts/` هستند.

گردش‌کار [GitHub Actions](.github/workflows/publish.yml) تست‌های منطق، تحویل آزمایشی SMTP، تست Chromium و smoke test کانتینر را اجرا می‌کند. پس از موفقیت، برای `main` تگ `latest` و برای شاخهٔ تحویل تگ `preview` ساخته می‌شود. تگ `sha-<commit>` هم برای هر دو پلتفرم `linux/amd64` و `linux/arm64` منتشر می‌شود. برای به‌روزرسانی `docker compose pull && docker compose up -d --wait`. لاگ‌ها `docker compose logs -f website`؛ برای بازگشت ایمیج را روی تگ SHA قبلی تنظیم کنید. مسیرهای قدیمی `omixy` و `*.text` در مخزن دست‌نخورده‌اند و در کانتینر سرو نمی‌شوند.

### پشتیبان‌گیری و بازیابی خبرنامه

SQLite در volume `subscribers` است. از `docker compose down -v` استفاده نکنید مگر قصد حذف اطلاعات را دارید. پس از یک توقف تمیز، پایگاه بسته می‌شود و می‌توان فایل را برداشت:

```sh
umask 077
docker compose stop website
docker compose cp website:/app/data/subscribers.sqlite ./subscribers.backup.sqlite
chmod 600 ./subscribers.backup.sqlite
docker compose up -d --wait
```

برای بازیابی، اول از دیتابیس فعلی نسخه بگیرید، سرویس را متوقف کنید و با همان کاربر کانتینر فایل را در volume بنویسید:

```sh
docker compose stop website
docker compose run --rm --no-deps -T website sh -c 'umask 077; cat > /app/data/restore.tmp && rm -f /app/data/subscribers.sqlite-wal /app/data/subscribers.sqlite-shm && mv /app/data/restore.tmp /app/data/subscribers.sqlite' < subscribers.backup.sqlite
docker compose up -d --wait
```
