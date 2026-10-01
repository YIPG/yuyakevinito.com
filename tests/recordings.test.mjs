import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileVideos, validateVideo, MAX_VIDEO_BYTES } from '../scripts/recordings.mjs';

test('only the representative mobile profile supplies recordings', () => {
  const report = { specs: [{ title: 'metadata', tests: [
    { projectName: 'chromium-desktop', results: [{ attachments: [{ name: 'video', contentType: 'video/webm', path: 'desktop.webm' }] }] },
    { projectName: 'webkit-mobile', results: [{ attachments: [{ name: 'video', contentType: 'video/webm', path: 'webkit.webm' }] }] },
    { projectName: 'chromium-mobile', results: [{ attachments: [{ name: 'video', contentType: 'video/webm', path: 'mobile.webm' }] }] },
  ] }] };
  assert.deepEqual([...mobileVideos(report)], [['metadata', 'mobile.webm']]);
});

test('lightweight recordings require portrait H264, at most 12fps, no audio, and a hard byte limit', () => {
  const info = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 360, height: 780, avg_frame_rate: '12/1' }], format: { duration: '8' } };
  assert.deepEqual(validateVideo(info, 100_000), { width: 360, height: 780, durationMs: 8_000 });
  assert.throws(() => validateVideo(info, MAX_VIDEO_BYTES + 1), /limits/);
  assert.throws(() => validateVideo({ ...info, streams: [...info.streams, { codec_type: 'audio' }] }, 100_000), /limits/);
  assert.throws(() => validateVideo({ ...info, streams: [{ ...info.streams[0], width: 1280 }] }, 100_000), /limits/);
  assert.throws(() => validateVideo({ ...info, streams: [{ ...info.streams[0], avg_frame_rate: '30/1' }] }, 100_000), /limits/);
  assert.throws(() => validateVideo({ ...info, format: { duration: '61' } }, 100_000), /limits/);
});
