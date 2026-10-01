import { test, expect, step, visit } from './shared/steps.mjs';

const apps = [
  ['kakusu', 'https://kakusu.yuyakevinito.com/'], ['Karuku', 'https://karuku.yuyakevinito.com/'],
  ['koe', 'https://koe.yuyakevinito.com/'], ['X Card Tools', 'https://xcard.yuyakevinito.com/'],
];

test('service-links', async ({ page }) => {
  await visit(page, 'Open the homepage and find the apps');
  for (const [name, url] of apps) {
    await step(page, `Open ${name} from the homepage`, async () => {
      const link = page.getByRole('link', { name: new RegExp(`^${name}\\b`) });
      await expect(link).toHaveAttribute('href', url);
      const response = page.waitForResponse(response => response.request().isNavigationRequest() && response.url() === url);
      await link.click();
      expect((await response).status()).toBe(200);
      await expect(page).toHaveURL(url);
    });
    await step(page, 'Use Back to return to the homepage', async () => {
      await page.goBack();
      await expect(page).toHaveURL('https://yuyakevinito.com/');
      await expect(page.locator('h1')).toBeVisible();
    });
  }
});

test('layout-keyboard', async ({ page, browserName }) => {
  await visit(page, 'Open the homepage at a phone-sized viewport');
  await step(page, 'Use the keyboard to reach an app link', async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const link = page.getByRole('link', { name: /^kakusu\b/ });
    const key = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
    for (let i = 0; i < 12 && !await link.evaluate(node => node === document.activeElement); i++) await page.keyboard.press(key);
    await expect(link).toBeFocused();
    expect(await link.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
  });
  await step(page, 'Press Enter to open kakusu', async () => {
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('https://kakusu.yuyakevinito.com/');
  });
});

test.describe('Without scripts', () => {
  test.use({ javaScriptEnabled: false });
  test('no-javascript', async ({ page }) => {
    await visit(page, 'JavaScript is disabled: the homepage still loads');
    await step(page, 'Check that all app links remain available', async () => {
      for (const [name, url] of apps) await expect(page.getByRole('link', { name: new RegExp(`^${name}\\b`) })).toHaveAttribute('href', url);
    });
    await step(page, 'Open X Card Tools without JavaScript', async () => {
      await page.getByRole('link', { name: /^X Card Tools\b/ }).click();
      await expect(page).toHaveURL('https://xcard.yuyakevinito.com/');
    });
  });
});

test('metadata', async ({ page, request }) => {
  await visit(page, 'Check the homepage URL and sharing metadata');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://yuyakevinito.com/');
  await step(page, 'Open the 1200 by 630 sharing image', async () => {
    const url = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(url).toBe('https://yuyakevinito.com/social-card.png');
    const response = await request.get(url);
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
    await page.goto(url);
  });
  await step(page, 'Check the site icons', async () => {
    for (const path of ['/favicon.png', '/favicon.svg', '/apple-touch-icon.png']) {
      expect((await request.get(`https://yuyakevinito.com${path}`)).status()).toBe(200);
    }
    await page.goto('https://yuyakevinito.com/favicon.png');
  });
  await step(page, 'A missing page returns a real 404', async () => {
    expect((await page.goto('https://yuyakevinito.com/site-checks-missing-page')).status()).toBe(404);
  });
});
