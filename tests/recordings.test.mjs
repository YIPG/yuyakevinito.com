import test from 'node:test';
import assert from 'node:assert/strict';
import { captures, validateVideo, captionSegments, MAX_VIDEO_BYTES } from '../scripts/recordings.mjs';

test('only the mobile profile supplies a high-resolution capture', () => {
  const report = { specs: [{ title: 'metadata', tests: [
    { projectName: 'chromium-desktop', results: [{ attachments: [] }] },
    { projectName: 'chromium-mobile', results: [{ attachments: [{ name: 'mobile-capture', path: '/capture.json' }] }] },
  ] }] };
  assert.deepEqual([...captures(report, ['metadata'])], [['metadata', '/capture.json']]);
});

test('videos must be genuine 720p or higher, silent, and within the 50MB ceiling', () => {
  const info = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1702 }], format: { duration: '8' } };
  assert.deepEqual(validateVideo(info, 2_000_000), { width: 720, height: 1702, durationMs: 8_000 });
  assert.throws(() => validateVideo(info, MAX_VIDEO_BYTES + 1), /50MB/);
  assert.throws(() => validateVideo({ ...info, streams: [...info.streams, { codec_type: 'audio' }] }, 100_000), /silent/);
  assert.throws(() => validateVideo({ ...info, streams: [{ ...info.streams[0], width: 360 }] }, 100_000), /720p/);
});

test('captions align with the captured timeline without overlapping early steps', () => {
  const segments = captionSegments([{ atMs: 100, text: 'Open the homepage' }, { atMs: 1100, text: 'Click the link' }], 100, 2000);
  assert.deepEqual(segments, [{ start: 0, end: 1000, text: 'Open the homepage' }, { start: 1000, end: 2000, text: 'Click the link' }]);
  assert.deepEqual(captionSegments([{ atMs: 0, text: 'Before capture' }, { atMs: 100, text: 'Visible' }], 200, 1000),
    [{ start: 0, end: 1000, text: 'Visible' }]);
  assert.throws(() => captionSegments([], 0, 2000), /captions/);
});
