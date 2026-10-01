// Generated from YIPG/health runner/shared; edit the source and resync.
import { test as base, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { relative, resolve } from 'node:path';
import { settings } from './settings.mjs';

const sessions = new WeakMap();

class Capture {
  constructor(page, info) {
    this.page = page;
    this.info = info;
    this.directory = info.outputPath('capture');
    this.frames = [];
    this.cues = [];
  }
  cue(text) {
    if (!this.startedAt) {
      this.startedAt = Date.now();
    }
    this.cues.push({ atMs: Date.now() - this.startedAt, text });
  }
  async snapshot() {
    if (this.failure) return;
    await mkdir(this.directory, { recursive: true });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const bytes = await this.page.screenshot({ type: 'jpeg', quality: 95, scale: 'device', timeout: 10_000 });
        const name = `frame-${String(this.frames.length).padStart(5, '0')}.jpg`;
        await writeFile(resolve(this.directory, name), bytes);
        this.frames.push({ file: name, atMs: Date.now() - this.startedAt });
        return;
      } catch (error) {
        if (!error.message.includes('Unable to capture screenshot') || attempt === 2) {
          this.failure = error;
          console.error(`Recording capture failed: ${error.message}`);
          return;
        }
        console.warn('Retrying a screen capture after navigation.');
        await setTimeout(200);
      }
    }
  }
  async stop() {
    const manifest = {
      captureMode: 'narrated-steps',
      frameDirectory: relative(process.cwd(), this.directory),
      startedAt: this.startedAt, durationMs: this.startedAt ? Date.now() - this.startedAt : 0,
      frames: this.frames, cues: this.cues, error: this.failure?.message ?? null,
    };
    await mkdir(this.directory, { recursive: true });
    const path = resolve(this.directory, 'capture.json');
    await writeFile(path, JSON.stringify(manifest));
    await this.info.attach('mobile-capture', { path, contentType: 'application/json' });
  }
}

export const test = base.extend({
  page: async ({ page }, providePage, info) => {
    const capture = info.project.name === 'chromium-mobile' ? new Capture(page, info) : null;
    sessions.set(page, { info, capture });
    try { await providePage(page); }
    finally {
      if (capture) await capture.stop();
      sessions.delete(page);
    }
  },
});
export { expect };

export async function step(page, text, action) {
  const session = sessions.get(page);
  if (!session) throw new Error('Use the shared page fixture for narrated checks');
  if (text.length > 110) throw new Error('Keep recording captions short');
  session.capture?.cue(text);
  if (session.capture?.frames.length) await session.capture.snapshot();
  try {
    return await action();
  } finally {
    if (session.capture) {
      await setTimeout(250);
      await session.capture.snapshot();
      await setTimeout(900);
    }
  }
}

export async function visit(page, caption = 'Open the website') {
  const site = settings();
  return step(page, caption, async () => {
    const response = await page.goto(site.url);
    expect(response?.status()).toBe(200);
    sessions.get(page).info.annotations.push({ type: 'site-version', description: response.headers()['x-site-version'] ?? 'missing' });
    await expect(page.locator('h1').first()).toBeVisible();
    return response;
  });
}
