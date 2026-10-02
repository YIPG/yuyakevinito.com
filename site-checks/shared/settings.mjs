// Generated from YIPG/health runner/shared; edit the source and resync.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const profiles = ['chromium-desktop', 'chromium-mobile', 'webkit-desktop', 'webkit-mobile'];
export function settings() {
  const value = JSON.parse(readFileSync(resolve('site-checks/site.json'), 'utf8'));
  if (!['home', 'kakusu', 'karuku'].includes(value.id)
    || !value.url.startsWith('https://') || !Array.isArray(value.scenarioIds)) {
    throw new Error('Invalid site-check configuration');
  }
  return value;
}
