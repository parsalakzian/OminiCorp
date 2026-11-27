import { expect, test } from '@playwright/test';

for (const [url, lang] of [['/', 'fa'], ['/en.html', 'en']]) {
  test(`${lang} renders cleanly and only loads local resources`, async ({ page }) => {
    const errors = [];
    const external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (!response.ok()) errors.push(response.url()); });
    page.on('request', (request) => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.locator('img:not([alt]), img:not([width]), img:not([height])')).toHaveCount(0);
    const headings = (await page.locator('main :is(h1,h2,h3)').allTextContents()).map((label) => label.trim());
    expect(new Set(headings).size).toBe(headings.length);
    for (const id of ['request-name', 'request-email', 'request-message', 'subscribe-email', 'subscribe-consent']) {
      expect(await page.locator(`#${id}`).evaluate((field) => field.labels?.[0]?.textContent.trim())).toBeTruthy();
    }
    await expect(page.locator('.service-action')).toHaveCount(5);
    await expect(page.locator('.home-journal-card')).toHaveCount(3);
    const journal = page.locator('.home-journal');
    await expect(journal.locator('h2')).toHaveText(lang === 'fa' ? 'تازه‌ترین نوشته‌ها' : 'Latest articles');
    const preview = journal.locator('img').first();
    await preview.scrollIntoViewIfNeeded();
    await expect.poll(() => preview.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    for (const width of [1440, 1024, 768, 760, 430, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${lang} at ${width}px`).toBe(width);
    }
    await expect(page.locator('.contact-card').first()).toHaveAttribute('href', 'tel:+989054847599');
    await page.locator('.locale').click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang === 'fa' ? 'en' : 'fa');
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}

test('keyboard details, guide recommendation and consultation destination', async ({ page }) => {
  await page.goto('/');
  const first = page.locator('.service-action').first();
  const details = page.locator('#details');
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(details).toBeVisible();
  await expect(details.locator('li')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(first).toBeFocused();

  await page.locator('[data-open="guide"]').first().click();
  await page.locator('[data-goal="1"]').click();
  await expect(page.locator('[data-goal="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.guide-result li')).toHaveCount(2);
  await page.locator('.guide-result button').first().click();
  await expect(details.locator('h2')).toHaveText('امنیت و شبکه');
  await details.locator('[data-contact]').click();
  await expect(page).toHaveURL(/#contacts$/);
  await expect(page.locator('.contact-card').first()).toBeFocused();
});

test('display controls wrap and pause autoplay', async ({ page }) => {
  await page.clock.install();
  await page.goto('/en.html');
  await page.locator('[data-open="display"]').click();
  const slide = page.locator('.slide h3');
  await expect(slide).toHaveText('Software & AI');
  await page.locator('[data-slide="-1"]').click();
  await expect(slide).toHaveText('Architecture & Build');
  await page.locator('[data-play]').click();
  await page.clock.runFor(9100);
  await expect(slide).toHaveText('Software & AI');
  await page.locator('[data-play]').click();
  await page.clock.runFor(9100);
  await expect(slide).toHaveText('Software & AI');
  await page.keyboard.press('Escape');
  await expect(page.locator('#display')).not.toBeVisible();
});

test('without JavaScript, catalog and contacts still work', async ({ browser }) => {
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.goto('http://127.0.0.1:4317/');
  await page.locator('.service-card summary').first().click();
  await expect(page.locator('.service-card details[open] li')).toHaveCount(3);
  await expect(page.locator('.contact-card').first()).toHaveAttribute('href', 'tel:+989054847599');
  await page.close();
});

test('TV deep link autoplays with reduced-motion support and keyboard controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/?tv=1');
  await expect(page.locator('#display')).toBeVisible();
  await expect(page.locator('#display')).toHaveClass(/is-playing/);
  await expect(page.locator('.tv-art img')).toHaveCSS('animation-name', 'none');
  await page.clock.runFor(9100);
  await expect(page.locator('#display')).toHaveAttribute('data-scene', 'security');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#display')).toHaveAttribute('data-scene', 'hardware');
  await expect(page.locator('#display')).not.toHaveClass(/is-playing/);
});

test('contact forms reflect enabled server, submit consent, and show delivery errors', async ({ page }) => {
  await page.route('**/api/forms', (route) => route.fulfill({ json: { code: 'available' } }));
  await page.route('**/api/request', (route) => route.fulfill({ status: 503, json: { code: 'unavailable' } }));
  await page.route('**/api/subscribe', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ email: 'reader@example.org', consent: true, lang: 'en' });
    return route.fulfill({ status: 202, json: { code: 'sent' } });
  });
  await page.goto('/en.html');
  const request = page.locator('[data-mail="request"]');
  const subscribe = page.locator('[data-mail="subscribe"]');
  await subscribe.getByLabel('Email', { exact: true }).fill('reader@example.org');
  await subscribe.getByRole('checkbox').check();
  await subscribe.getByRole('button').click();
  await expect(subscribe.getByRole('status')).toContainText('confirmation link');
  await expect(subscribe.getByLabel('Email', { exact: true })).toHaveValue('');
  await request.getByLabel('Name').fill('Client');
  await request.getByLabel('Email', { exact: true }).fill('client@example.org');
  await request.getByLabel('Project brief').fill('A brief for our new project.');
  await request.getByRole('button').click();
  await expect(request.getByRole('status')).toContainText('Could not send');
  await expect(request.getByLabel('Project brief')).toHaveValue('A brief for our new project.');
});

test('TV enters and exits fullscreen from its display controls', async ({ page }) => {
  await page.goto('/?tv=1');
  const button = page.locator('[data-fullscreen]');
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('tv-screen');
  await button.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});
