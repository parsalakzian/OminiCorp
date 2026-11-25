import { expect, test } from '@playwright/test';
import { seed } from '../server/blog/seed.mjs';

async function responsive(page) {
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `viewport ${width}`).toBe(width);
  }
}

async function login(page) {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/setup$/);
  await page.locator('[name="code"]').fill('z'.repeat(43));
  await page.locator('[name="password"]').fill('editorial-test-fixture-only');
  await page.locator('[name="confirmation"]').fill('editorial-test-fixture-only');
  await page.getByRole('button', { name: 'ساخت حساب ادمین' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel('رمز عبور').fill('editorial-test-fixture-only');
  await page.getByRole('button', { name: 'ورود به پنل' }).click();
  await expect(page.getByRole('heading', { name: 'مدیریت مجله' })).toBeVisible();
}

test('bilingual journal layout, filtering, search and reciprocal article links work locally', async ({ page }) => {
  const external = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (new URL(request.url()).origin !== 'http://127.0.0.1:4317') external.push(request.url()); });
  await page.goto('/');
  await page.getByRole('link', { name: 'وبلاگ', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.journal-card')).toHaveCount(3);
  await responsive(page);
  await page.getByRole('link', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await responsive(page);
  await page.getByRole('link', { name: 'Security', exact: true }).click();
  await expect(page.locator('.journal-card')).toHaveCount(1);
  await page.getByRole('searchbox').fill('speed not found');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No articles found.')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
  await page.goto('/en/blog');
  await page.getByRole('link', { name: seed[0].en.title, exact: true }).click();
  await expect(page.locator('h1')).toHaveText(seed[0].en.title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `http://127.0.0.1:4317/en/blog/${seed[0].en.slug}`);
  await page.getByRole('link', { name: 'فارسی', exact: true }).click();
  await expect(page.locator('h1')).toHaveText(seed[0].fa.title);
  await responsive(page);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('responsive desk writes both translations, publishes, updates settings and logs out', async ({ page }) => {
  await login(page);
  await responsive(page);
  await page.getByRole('link', { name: '+ مقالهٔ جدید', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'مقالهٔ جدید' })).toBeVisible();
  await responsive(page);
  const value = structuredClone(seed[0]);
  value.fa.title = 'عنوان مقالهٔ آزمایشی وبلاگ';
  value.en.title = 'A bilingual editorial test article';
  value.fa.slug = 'مقاله-آزمایشی';
  value.en.slug = 'bilingual-editorial-test';
  for (const locale of ['fa', 'en']) {
    for (const [key, field] of Object.entries(value[locale])) await page.locator(`[name="${locale}.${key}"]`).fill(Array.isArray(field) ? field.join(', ') : field);
  }
  await page.getByRole('button', { name: 'ذخیرهٔ مقاله' }).click();
  await expect(page.locator('.desk-notice')).toContainText('مقاله ذخیره شد');
  expect((await page.request.get(`/en/blog/${value.en.slug}`)).status()).toBe(404);
  await page.getByRole('link', { name: value.fa.title }).click();
  await page.getByRole('link', { name: 'پیش‌نمایش انگلیسی' }).click();
  await expect(page.locator('h1')).toHaveText(value.en.title);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
  await page.getByRole('link', { name: 'Private preview · Back to editor' }).click();
  await page.locator('select[name="state"]').selectOption('published');
  await page.getByRole('button', { name: 'ذخیرهٔ مقاله' }).click();
  expect((await page.request.get(`/en/blog/${value.en.slug}`)).status()).toBe(200);
  await expect(page.getByRole('link', { name: 'تنظیمات مجله', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'تنظیمات سایت', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'تنظیمات سایت' })).toBeVisible();
  await expect(page.locator('[name="aiModel"], [name="mcp"], [name="aiKey"]')).toHaveCount(0);
  await responsive(page);
  const tabs = page.getByRole('navigation', { name: 'بخش‌های تنظیمات سایت' });
  await tabs.getByRole('link', { name: 'هوش مصنوعی' }).click();
  await expect(page.getByRole('heading', { name: 'هوش مصنوعی و خودکارسازی' })).toBeVisible();
  await expect(page.locator('[name="mcp"], [name="smtpHost"]')).toHaveCount(0);
  await responsive(page);
  await page.getByRole('checkbox', { name: 'تولید با هوش مصنوعی' }).check();
  await page.getByRole('checkbox', { name: 'تولید زمان‌بندی‌شده' }).check();
  await page.locator('[name="aiModel"]').fill('test-model');
  await page.locator('[name="proxyUrl"]').fill('http://proxy.example.test:3128');
  await page.locator('[name="feeds"]').fill('https://feed.example.test/rss.xml');
  await page.locator('[name="aiKey"]').fill('one-time-test-ai-placeholder');
  await page.getByRole('button', { name: 'ذخیرهٔ تنظیمات هوش مصنوعی' }).click();
  await expect(page.locator('[name="aiModel"]')).toHaveValue('test-model');
  await expect(page.locator('[name="proxyUrl"]')).toHaveValue('http://proxy.example.test:3128');
  await expect(page.locator('[name="aiKey"]')).toHaveValue('');
  await tabs.getByRole('link', { name: 'MCP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'تنظیمات MCP' })).toBeVisible();
  await expect(page.locator('[name="aiModel"], [name="smtpHost"]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'سرور MCP' }).check();
  await page.getByRole('button', { name: 'ذخیرهٔ دسترسی MCP' }).click();
  await expect(page.getByRole('checkbox', { name: 'سرور MCP' })).toBeChecked();
  await page.getByRole('button', { name: 'ساخت توکن تصادفی' }).click();
  await expect(page.getByLabel('توکن جدید MCP')).toHaveValue(/^[a-zA-Z0-9_-]{43}$/);
  const originalToken = await page.getByLabel('توکن جدید MCP').inputValue();
  await responsive(page);
  await page.reload();
  await expect(page.getByLabel('توکن جدید MCP')).toHaveCount(0);
  await page.getByRole('button', { name: 'تعویض توکن با توکن تصادفی' }).click();
  await expect(page.getByLabel('توکن جدید MCP')).not.toHaveValue(originalToken);
  await page.getByRole('button', { name: 'لغو توکن' }).click();
  await expect(page.getByText('هنوز توکنی ایجاد نشده است.')).toBeVisible();
  await tabs.getByRole('link', { name: 'عمومی و حساب' }).click();
  await page.locator('[name="current"]').fill('wrong-password-for-fixture');
  await page.locator('[name="password"]').fill('updated-editorial-fixture-password');
  await page.locator('[name="confirmation"]').fill('updated-editorial-fixture-password');
  await page.getByRole('button', { name: 'تغییر رمز ادمین' }).click();
  await expect(page.locator('.desk-notice[role="alert"]')).toContainText('رمز فعلی درست نیست');
  await page.locator('[name="current"]').fill('editorial-test-fixture-only');
  await page.locator('[name="password"]').fill('updated-editorial-fixture-password');
  await page.locator('[name="confirmation"]').fill('updated-editorial-fixture-password');
  await page.getByRole('button', { name: 'تغییر رمز ادمین' }).click();
  await expect(page).toHaveURL(/\/admin\/login\?changed=1$/);
  await page.getByLabel('رمز عبور').fill('updated-editorial-fixture-password');
  await page.getByRole('button', { name: 'ورود به پنل' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('button', { name: 'خروج' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
});
