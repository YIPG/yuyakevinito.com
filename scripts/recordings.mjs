import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const recordingScenarios = ['service-links', 'layout-keyboard', 'no-javascript', 'metadata'];

export const MAX_VIDEO_BYTES = 1_000_000;
export const MAX_POSTER_BYTES = 65_536;
const root = fileURLToPath(new URL('../', import.meta.url));
const state = resolve(root, '.site-checks');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function mobileVideos(report) {
  const videos = new Map();
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      if (!recordingScenarios.includes(spec.title)) throw new Error('Unknown recorded scenario');
      for (const test of spec.tests ?? []) {
        if (test.projectName !== 'chromium-mobile') continue;
        const attachments = (test.results?.at(-1)?.attachments ?? [])
          .filter(item => item.name === 'video' && item.contentType === 'video/webm');
        if (attachments.length > 1 || videos.has(spec.title)) throw new Error('Duplicate mobile recording');
        if (attachments.length === 1) {
          if (typeof attachments[0].path !== 'string') throw new Error('Missing recording path');
          videos.set(spec.title, attachments[0].path);
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(report);
  return videos;
}

function probe(path) {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
  ], { encoding: 'utf8' }));
}

export function validateVideo(info, bytes) {
  const stream = info.streams.find(stream => stream.codec_type === 'video');
  const duration = Number(info.format.duration);
  const [frames, seconds] = (stream?.avg_frame_rate ?? '0/1').split('/').map(Number);
  if (!stream || info.streams.length !== 1 || stream.codec_name !== 'h264'
    || stream.width !== 360 || stream.height <= 360 || stream.height > 800
    || !Number.isFinite(duration) || duration <= 0 || duration > 60
    || !(frames / seconds > 0 && frames / seconds <= 12.1)
    || bytes <= 0 || bytes > MAX_VIDEO_BYTES) {
    throw new Error('Recording exceeds the mobile video limits');
  }
  return { width: stream.width, height: stream.height, durationMs: Math.ceil(duration * 1000) };
}

export async function encodeRecordings() {
  const run = JSON.parse(await readFile(resolve(state, 'run.json'), 'utf8'));
  if (!uuid.test(run.id)) throw new Error('Invalid recording run ID');
  const report = JSON.parse(await readFile(resolve(state, 'playwright.json'), 'utf8'));
  const videos = mobileVideos(report);
  const output = resolve(state, 'recordings', run.id);
  await mkdir(output, { recursive: true });
  const allowed = await realpath(resolve(root, 'test-results'));
  const recordings = [];
  for (const [scenario, path] of videos) {
    const input = await realpath(resolve(root, path));
    const local = relative(allowed, input);
    if (local.startsWith(`..${sep}`) || local === '..' || resolve(allowed, local) !== input) {
      throw new Error('Recording path is outside the test output');
    }
    const video = resolve(output, `${scenario}.mp4`);
    const provenance = `Origin: actual Playwright mobile recording of https://yuyakevinito.com/; scenario ${scenario}; recorded ${run.startedAt}; version ${run.versionBefore}.`;
    for (const [crf, rate, buffer] of [['32', '160k', '320k'], ['36', '100k', '200k']]) {
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map', '0:v:0', '-an',
        '-vf', 'fps=12,scale=360:-2', '-c:v', 'libx264', '-preset', 'medium', '-crf', crf,
        '-maxrate', rate, '-bufsize', buffer, '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-map_metadata', '-1', '-map_chapters', '-1', '-metadata', `comment=${provenance}`, video,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      if ((await stat(video)).size <= MAX_VIDEO_BYTES) break;
    }
    const bytes = await readFile(video);
    const dimensions = validateVideo(probe(video), bytes.length);
    const poster = resolve(output, `${scenario}.jpg`);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.min(1, dimensions.durationMs / 2000)),
      '-i', video, '-frames:v', '1', '-q:v', '6', '-map_metadata', '-1', poster,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const original = await readFile(poster);
    const comment = Buffer.from(provenance, 'utf8');
    const marker = Buffer.alloc(comment.length + 4);
    marker[0] = 0xff;
    marker[1] = 0xfe;
    marker.writeUInt16BE(comment.length + 2, 2);
    comment.copy(marker, 4);
    const image = Buffer.concat([original.subarray(0, 2), marker, original.subarray(2)]);
    if (image.length > MAX_POSTER_BYTES) throw new Error('Recording poster exceeds the size limit');
    await writeFile(poster, image);
    recordings.push({
      scenario, profile: 'chromium-mobile', ...dimensions, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      posterBytes: image.length, posterSha256: createHash('sha256').update(image).digest('hex'),
    });
    console.log(`${scenario}: ${Math.ceil(bytes.length / 1024)} KiB, ${dimensions.durationMs} ms, 360px / 12fps / no audio`);
  }
  await writeFile(resolve(state, 'recordings.json'), JSON.stringify({ runId: run.id, recordings }));
  if (recordings.length !== recordingScenarios.length) throw new Error('Some mobile recordings were not produced');
}

export async function uploadRecordings(runId, secret, fetcher = fetch) {
  if (!uuid.test(runId)) throw new Error('Invalid recording run ID');
  const manifest = JSON.parse(await readFile(resolve(state, 'recordings.json'), 'utf8'));
  if (manifest.runId !== runId) throw new Error('Recordings belong to a different test run');
  for (const recording of manifest.recordings) {
    if (!recordingScenarios.includes(recording.scenario) || recording.profile !== 'chromium-mobile') {
      throw new Error('Invalid recording manifest');
    }
    for (const extension of ['mp4', 'jpg']) {
      const bytes = await readFile(resolve(state, 'recordings', runId, `${recording.scenario}.${extension}`));
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== (extension === 'mp4' ? recording.sha256 : recording.posterSha256)) {
        throw new Error('Recording changed after compression');
      }
      const path = `/api/recordings/home/${runId}/${recording.scenario}.${extension}`;
      const timestamp = String(Date.now());
      const signature = `sha256=${createHmac('sha256', secret).update(`${path}\n${timestamp}\n`).update(bytes).digest('hex')}`;
      const response = await fetcher(`https://health.yuyakevinito.com${path}`, {
        method: 'PUT', body: bytes, signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': extension === 'mp4' ? 'video/mp4' : 'image/jpeg',
          'X-Site-Checks-Time': timestamp, 'X-Site-Checks-Signature': signature,
        },
      });
      await response.body?.cancel();
      if (response.status !== 200) throw new Error(`Recording upload rejected: HTTP ${response.status}`);
    }
  }
  return manifest.recordings;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await encodeRecordings();
}
