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
    await expect(page.locator('.service-action')).toHaveCount(5);
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
  await page.clock.runFor(6600);
  await expect(slide).toHaveText('Software & AI');
  await page.locator('[data-play]').click();
  await page.clock.runFor(6600);
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
