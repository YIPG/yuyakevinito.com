import { test, expect } from '@playwright/test';

const services = [
  ['kakusu', 'https://kakusu.yuyakevinito.com/'],
  ['Karuku', 'https://karuku.yuyakevinito.com/'],
  ['koe', 'https://koe.yuyakevinito.com/'],
  ['X Card Tools', 'https://xcard.yuyakevinito.com/'],
];

const recordsMobile = testInfo => testInfo.project.name === 'chromium-mobile';

async function recordingPause(page, testInfo) {
  // Leave completed actions readable in the mobile recording, not to synchronize the test.
  if (recordsMobile(testInfo)) await page.waitForTimeout(650);
}

async function home(page, testInfo) {
  const response = await page.goto('https://yuyakevinito.com/');
  expect(response.status()).toBe(200);
  testInfo.annotations.push({ type: 'site-version', description: response.headers()['x-site-version'] ?? 'missing' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await recordingPause(page, testInfo);
}

test('service-links', async ({ page }, testInfo) => {
  for (const [name, destination] of services) {
    await home(page, testInfo);
    const link = page.getByRole('link', { name: new RegExp(`^${name}\\b`) });
    await expect(link).toHaveAttribute('href', destination);
    const navigation = page.waitForResponse(response =>
      response.request().isNavigationRequest() && response.url() === destination);
    await link.click();
    expect((await navigation).status()).toBe(200);
    await expect(page).toHaveURL(destination);
    await recordingPause(page, testInfo);
    await page.goBack();
    await expect(page).toHaveURL('https://yuyakevinito.com/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('layout-keyboard', async ({ page, browserName }, testInfo) => {
  await home(page, testInfo);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const link = page.getByRole('link', { name: /^kakusu\b/ });
  // macOS WebKit uses Option+Tab to include links in keyboard navigation.
  const nextLink = browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
  for (let attempt = 0; attempt < 12 && !await link.evaluate(node => node === document.activeElement); attempt++) {
    await page.keyboard.press(nextLink);
  }
  await expect(link).toBeFocused();
  expect(await link.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
  await recordingPause(page, testInfo);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('https://kakusu.yuyakevinito.com/');
  await recordingPause(page, testInfo);
});

test('no-javascript', async ({ browser }, testInfo) => {
  const recording = recordsMobile(testInfo);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: testInfo.project.use.viewport,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
    recordVideo: recording ? { dir: testInfo.outputPath('recording'), size: { width: 390, height: 844 } } : undefined,
  });
  let page;
  try {
    page = await context.newPage();
    await home(page, testInfo);
    for (const [name, destination] of services) {
      await expect(page.getByRole('link', { name: new RegExp(`^${name}\\b`) })).toHaveAttribute('href', destination);
    }
    await page.getByRole('link', { name: /^X Card Tools\b/ }).click();
    await expect(page).toHaveURL('https://xcard.yuyakevinito.com/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await recordingPause(page, testInfo);
  } finally {
    await context.close();
    if (recording && page?.video()) {
      await testInfo.attach('video', { path: await page.video().path(), contentType: 'video/webm' });
    }
  }
});

test('metadata', async ({ page, request }, testInfo) => {
  await home(page, testInfo);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://yuyakevinito.com/');
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://yuyakevinito.com/');
  const image = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(image).toBe('https://yuyakevinito.com/social-card.png');
  const social = await request.get(image);
  expect(social.status()).toBe(200);
  expect(social.headers()['content-type']).toContain('image/png');
  const png = await social.body();
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
  for (const asset of ['/favicon.png', '/favicon.svg', '/apple-touch-icon.png']) {
    expect((await request.get(asset)).status()).toBe(200);
  }
  expect((await request.get('/site-checks-missing-page')).status()).toBe(404);
  if (recordsMobile(testInfo)) {
    await page.goto(image);
    await recordingPause(page, testInfo);
    await page.goto('https://yuyakevinito.com/favicon.png');
    await recordingPause(page, testInfo);
    expect((await page.goto('https://yuyakevinito.com/site-checks-missing-page')).status()).toBe(404);
    await recordingPause(page, testInfo);
  }
});
