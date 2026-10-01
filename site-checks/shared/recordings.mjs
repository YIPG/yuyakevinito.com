// Generated from YIPG/health runner/shared; edit the source and resync.
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { settings } from './settings.mjs';

export const MAX_VIDEO_BYTES = 50_000_000;
export const MAX_POSTER_BYTES = 250_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const state = () => resolve('.site-checks');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function captures(report, scenarioIds) {
  const found = new Map();
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      if (!scenarioIds.includes(spec.title)) throw new Error(`Unexpected scenario: ${spec.title}`);
      for (const test of spec.tests ?? []) {
        if (test.projectName !== 'chromium-mobile') continue;
        const files = (test.results?.at(-1)?.attachments ?? []).filter(item => item.name === 'mobile-capture');
        if (files.length !== 1 || found.has(spec.title)) throw new Error(`Missing or duplicate mobile capture: ${spec.title}`);
        found.set(spec.title, files[0].path);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(report);
  return found;
}

function probe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' }));
}

export function validateVideo(info, bytes) {
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const duration = Number(info.format.duration);
  if (!video || info.streams.length !== 1 || video.codec_name !== 'h264'
    || video.width < 720 || video.width > 1080 || video.height <= video.width || video.height > 2600
    || !(duration > 0 && duration <= 300) || !(bytes > 0 && bytes <= MAX_VIDEO_BYTES)) {
    throw new Error('Recording must be portrait 720p+, silent, and within the 50MB limit');
  }
  return { width: video.width, height: video.height, durationMs: Math.ceil(duration * 1000) };
}

export function captionSegments(cues, offset, duration) {
  if (!cues.length || cues.some(cue => typeof cue.text !== 'string' || cue.text.length > 110 || !Number.isFinite(cue.atMs))) {
    throw new Error('Missing or invalid recording captions');
  }
  return cues.map((cue, index) => {
    const start = Math.max(0, cue.atMs - offset);
    const end = Math.min(duration, (cues[index + 1]?.atMs ?? offset + duration) - offset);
    if (end <= start) return null;
    return { start, end, text: cue.text };
  }).filter(Boolean);
}

export async function encodeRecordings() {
  const site = settings();
  const run = JSON.parse(await readFile(resolve(state(), 'run.json'), 'utf8'));
  if (!uuid.test(run.id)) throw new Error('Invalid recording run');
  const report = JSON.parse(await readFile(resolve(state(), 'playwright.json'), 'utf8'));
  const found = captures(report, site.scenarioIds);
  const output = resolve(state(), 'recordings', run.id);
  const allowed = await realpath(resolve(state(), 'results'));
  await mkdir(output, { recursive: true });
  const recordings = [];
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
  const captionPage = await browser.newPage({ viewport: { width: 720, height: 1702 }, deviceScaleFactor: 1 });
  await captionPage.setContent('<!doctype html><style>html,body{margin:0;width:720px;background:#20251f;color:white}#screen{display:block;width:720px;object-fit:contain;background:#f8f7f4}.caption-band{height:144px;display:grid;place-items:center}p{margin:0;padding:12px 24px;font:30px/1.25 Arial,sans-serif;text-align:center;overflow-wrap:anywhere}</style><img id="screen"><div class="caption-band"><p id="caption"></p></div>');
  for (const [scenario, manifestPath] of found) {
    const path = await realpath(manifestPath);
    const local = relative(allowed, path);
    if (local === '..' || local.startsWith(`..${sep}`)) throw new Error('Capture is outside the test output');
    const capture = JSON.parse(await readFile(path, 'utf8'));
    if (capture.error || capture.frames.length < 2 || !capture.cues.length) throw new Error(`Capture failed for ${scenario}`);
    if (typeof capture.frameDirectory !== 'string') throw new Error('Capture frame directory is missing');
    const directory = await realpath(resolve(capture.frameDirectory));
    const frameLocation = relative(allowed, directory);
    if (frameLocation === '..' || frameLocation.startsWith(`..${sep}`)) throw new Error('Frames are outside the test output');
    const first = capture.frames[0];
    if (!/^frame-\d{5}\.jpg$/.test(first.file)) throw new Error('Invalid first capture frame');
    const firstPath = await realpath(resolve(directory, first.file));
    if (dirname(firstPath) !== directory) throw new Error('Frame escaped capture directory');
    const source = probe(firstPath).streams[0];
    if (source.width < 720 || source.height <= source.width) throw new Error('Source capture is not genuine high-resolution mobile footage');
    const height = Math.round(source.height * 720 / source.width / 2) * 2 + 144;
    const duration = capture.durationMs - first.atMs;
    await captionPage.setViewportSize({ width: 720, height });
    await captionPage.locator('#screen').evaluate((node, value) => { node.style.height = `${value}px`; }, height - 144);
    const segments = captionSegments(capture.cues, first.atMs, duration);
    const frames = [];
    for (const [index, frame] of capture.frames.entries()) {
      if (!/^frame-\d{5}\.jpg$/.test(frame.file)) throw new Error('Invalid capture frame');
      const framePath = await realpath(resolve(directory, frame.file));
      if (dirname(framePath) !== directory) throw new Error('Frame escaped capture directory');
      const caption = segments.find(segment => frame.atMs - first.atMs >= segment.start && frame.atMs - first.atMs < segment.end);
      if (!caption) throw new Error('A captured frame has no narration');
      const image = await readFile(framePath);
      const dimensions = await captionPage.locator('#screen').evaluate(async (node, value) => {
        node.src = value;
        await node.decode();
        return { width: node.naturalWidth, height: node.naturalHeight };
      }, `data:image/jpeg;base64,${image.toString('base64')}`);
      if (dimensions.width < 720 || dimensions.height <= dimensions.width) throw new Error('A capture frame is below 720p');
      await captionPage.locator('#caption').evaluate((node, text) => { node.textContent = text; }, caption.text);
      const annotated = `annotated-${String(index).padStart(5, '0')}.png`;
      await captionPage.screenshot({ path: resolve(directory, annotated) });
      frames.push(`file '${annotated}'`, 'option framerate 1000',
        `duration ${Math.max(0.001, ((capture.frames[index + 1]?.atMs ?? capture.durationMs) - frame.atMs) / 1000)}`);
    }
    frames.push(`file 'annotated-${String(capture.frames.length - 1).padStart(5, '0')}.png'`, 'option framerate 1000');
    const concat = resolve(directory, 'frames.txt');
    await writeFile(concat, `${frames.join('\n')}\n`);
    const video = resolve(output, `${scenario}.mp4`);
    const provenance = `Origin: actual high-DPI mobile screens captured before and after narrated test steps at ${site.url}; ${scenario}; ${run.startedAt}; version ${run.versionBefore}; burned-in action captions. ${site.recordingCredit ?? ''}`;
    for (const crf of ['20', '23']) {
      execFileSync('ffmpeg', [
        '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat, '-an',
        '-vf', 'fps=24', '-t', String(duration / 1000),
        '-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', '-map_metadata', '-1', '-metadata', `comment=${provenance}`, video,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      if ((await stat(video)).size <= MAX_VIDEO_BYTES) break;
    }
    const bytes = await readFile(video);
    const dimensions = validateVideo(probe(video), bytes.length);
    if (Math.abs(dimensions.durationMs - duration) > 200) throw new Error(`Recording timeline mismatch: expected ${duration}ms, encoded ${dimensions.durationMs}ms`);
    const poster = resolve(output, `${scenario}.jpg`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.min(1, duration / 2000)), '-i', video,
      '-vf', 'scale=480:-2', '-frames:v', '1', '-q:v', '2', '-map_metadata', '-1', poster]);
    const image = await readFile(poster);
    const comment = Buffer.from(provenance);
    const marker = Buffer.alloc(comment.length + 4);
    marker[0] = 0xff; marker[1] = 0xfe; marker.writeUInt16BE(comment.length + 2, 2); comment.copy(marker, 4);
    const posterBytes = Buffer.concat([image.subarray(0, 2), marker, image.subarray(2)]);
    if (posterBytes.length > MAX_POSTER_BYTES) throw new Error('Poster exceeds the size limit');
    await writeFile(poster, posterBytes);
    recordings.push({ scenario, profile: 'chromium-mobile', ...dimensions, captioned: true,
      bytes: bytes.length, sha256: hash(bytes), posterBytes: posterBytes.length, posterSha256: hash(posterBytes) });
    console.log(`${scenario}: ${dimensions.width}x${dimensions.height}, ${Math.round(bytes.length / 1024)} KiB, captions included`);
  }
  await writeFile(resolve(state(), 'recordings.json'), JSON.stringify({ runId: run.id, recordings }));
  if (recordings.length !== site.scenarioIds.length) throw new Error('Some recordings are missing');
  } finally { await browser.close(); }
}

export async function uploadRecordings(runId, secret) {
  const site = settings();
  const manifest = JSON.parse(await readFile(resolve(state(), 'recordings.json'), 'utf8'));
  if (!uuid.test(runId) || manifest.runId !== runId) throw new Error('Recording run mismatch');
  for (const recording of manifest.recordings) {
    if (!site.scenarioIds.includes(recording.scenario)) throw new Error('Unknown recording');
    for (const extension of ['mp4', 'jpg']) {
      const path = resolve(state(), 'recordings', runId, `${recording.scenario}.${extension}`);
      const size = (await stat(path)).size;
      const checksum = createHash('sha256');
      for await (const chunk of createReadStream(path)) checksum.update(chunk);
      const sha256 = checksum.digest('hex');
      if (sha256 !== (extension === 'mp4' ? recording.sha256 : recording.posterSha256)) throw new Error('Recording changed');
      const endpoint = `/api/recordings/${site.id}/${runId}/${recording.scenario}.${extension}`;
      const time = String(Date.now());
      const type = extension === 'mp4' ? 'video/mp4' : 'image/jpeg';
      const signature = `sha256=${createHmac('sha256', secret).update(`v2\n${endpoint}\n${time}\n${sha256}\n${size}\n${type}`).digest('hex')}`;
      const response = await fetch(`https://health.yuyakevinito.com${endpoint}`, {
        method: 'PUT', body: createReadStream(path), duplex: 'half', signal: AbortSignal.timeout(60_000),
        headers: { 'Content-Type': type, 'Content-Length': String(size), 'X-Site-Checks-Time': time,
          'X-Recording-SHA256': sha256, 'X-Recording-Bytes': String(size), 'X-Site-Checks-Signature': signature },
      });
      await response.body?.cancel();
      if (response.status !== 200) throw new Error(`Recording upload failed: HTTP ${response.status}`);
    }
  }
  return manifest.recordings;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await encodeRecordings();
