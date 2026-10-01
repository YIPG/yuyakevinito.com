import { createHmac, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { recordingScenarios, uploadRecordings } from './recordings.mjs';

export const scenarios = recordingScenarios;
export const profiles = ['chromium-desktop', 'chromium-mobile', 'webkit-desktop', 'webkit-mobile'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const directory = new URL('../.site-checks/', import.meta.url);

export async function deploymentGate(eventName, event, fetcher = fetch) {
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') return { run: true, expectedVersion: null };
  const check = event.check_run;
  if (eventName !== 'check_run' || event.repository?.id !== 1391708243
    || event.action !== 'completed' || check?.app?.id !== 85455
    || check.name !== 'Workers Builds: yuyakevinito-com' || check.conclusion !== 'success') {
    return { run: false, expectedVersion: null };
  }
  if (!Number.isSafeInteger(check.check_suite?.id) || check.check_suite.id <= 0) {
    throw new Error('Deployment notification has no valid check suite');
  }
  const response = await fetcher(`https://api.github.com/repos/YIPG/yuyakevinito.com/check-suites/${check.check_suite.id}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Could not resolve deployment branch: HTTP ${response.status}`);
  const suite = await response.json();
  if (suite.app?.id !== 85455 || suite.head_branch !== 'main') return { run: false, expectedVersion: null };
  const expectedVersion = check.output?.summary?.match(/Version ID:\s*([a-f0-9-]{36})/i)?.[1];
  if (!expectedVersion || !uuid.test(expectedVersion)) throw new Error('Deployment notification has no valid version');
  return { run: true, expectedVersion: expectedVersion.toLowerCase() };
}

export function normalizedResults(report) {
  const found = new Map();
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      if (!scenarios.includes(spec.title)) throw new Error('Unexpected scenario in browser report');
      for (const test of spec.tests ?? []) {
        if (!profiles.includes(test.projectName)) throw new Error('Unexpected browser profile');
        const key = `${spec.title}:${test.projectName}`;
        if (found.has(key)) throw new Error('Duplicate browser result');
        const result = test.results?.at(-1);
        const annotations = result?.annotations ?? test.annotations ?? [];
        const versions = annotations.filter(item => item.type === 'site-version').map(item => item.description);
        const observedVersion = versions.length > 0 && versions.every(value => typeof value === 'string' && uuid.test(value)
          && value.toLowerCase() === versions[0].toLowerCase()) ? versions[0].toLowerCase() : null;
        const launchError = result?.errors?.some(error => /browserType\.launch|Executable doesn't exist/.test(error.message ?? ''));
        const outcome = result?.status === 'passed' ? 'passed'
          : !launchError && ['failed', 'timedOut'].includes(result?.status) ? 'failed' : 'not_run';
        found.set(key, {
          scenario: spec.title,
          profile: test.projectName,
          outcome,
          durationMs: Math.max(0, Math.round(result?.duration ?? 0)),
          observedVersion,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(report);
  return scenarios.flatMap(scenario => profiles.map(profile =>
    found.get(`${scenario}:${profile}`) ?? { scenario, profile, outcome: 'not_run', durationMs: 0, observedVersion: null }));
}

async function liveVersion() {
  const response = await fetch('https://yuyakevinito.com/', {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(20_000),
  });
  const version = response.headers.get('X-Site-Version');
  await response.body?.cancel();
  if (response.status !== 200 || !version || !uuid.test(version)) {
    throw new Error('The production version could not be confirmed');
  }
  return version.toLowerCase();
}

async function main() {
  const command = process.argv[2];
  if (command === 'gate') {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const gate = await deploymentGate(process.env.GITHUB_EVENT_NAME, event);
    await appendFile(process.env.GITHUB_OUTPUT, `run=${gate.run}\nexpected-version=${gate.expectedVersion ?? ''}\n`);
    console.log(gate.run ? 'Production browser checks are eligible.' : 'Not a successful production deployment; no report will be published.');
    return;
  }
  if (command === 'prepare') {
    await mkdir(directory, { recursive: true });
    for (const file of ['run.json', 'report.json', 'playwright.json', 'recordings.json']) await rm(new URL(file, directory), { force: true });
    const expectedVersion = process.env.EXPECTED_SITE_VERSION || null;
    if (expectedVersion && !uuid.test(expectedVersion)) throw new Error('Invalid expected production version');
    const run = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      versionBefore: null,
      expectedVersion,
    };
    try {
      run.versionBefore = await liveVersion();
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
    await writeFile(new URL('run.json', directory), JSON.stringify(run));
    return;
  }
  if (command !== 'publish') throw new Error('Use gate, prepare, or publish');
  const secret = process.env.SITE_CHECKS_SECRET;
  if (!secret) throw new Error('SITE_CHECKS_SECRET is not configured');
  let body;
  try {
    body = await readFile(new URL('report.json', directory), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (body === undefined) {
    await mkdir(directory, { recursive: true });
    const payload = await createReport();
    try {
      payload.recordings = await uploadRecordings(payload.id, secret);
      if (payload.recordings.length !== scenarios.length) throw new Error('Some mobile recordings are missing');
    } catch (error) {
      console.error(`Recordings unavailable: ${error.message}`);
      payload.recordingError = true;
      process.exitCode = 1;
    }
    body = JSON.stringify(payload);
    await writeFile(new URL('report.json', directory), body);
  }
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const response = await fetch('https://health.yuyakevinito.com/api/checks/home', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Site-Checks-Signature': signature },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  await response.body?.cancel();
  if (response.status !== 200) throw new Error(`Check report was rejected: HTTP ${response.status}`);
  const payload = JSON.parse(body);
  if (payload.recordingError) process.exitCode = 1;
  console.log(`Published ${payload.results.length} browser results; incomplete run: ${payload.runnerError}.`);
}

async function createReport() {
  let run;
  let report;
  let runnerError = false;
  for (const [file, assign] of [
    ['run.json', value => { run = value; }],
    ['playwright.json', value => { report = value; }],
  ]) {
    try {
      assign(JSON.parse(await readFile(new URL(file, directory), 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.error(`Missing ${file}; publishing an incomplete-run result.`);
      runnerError = true;
    }
  }
  let versionAfter = null;
  try {
    versionAfter = await liveVersion();
  } catch (error) {
    console.error(error.message);
    runnerError = true;
  }
  const results = normalizedResults(report ?? {});
  runnerError ||= results.some(result => result.outcome === 'not_run') || Boolean(report?.errors?.length);
  return {
    schemaVersion: 1,
    siteId: 'home',
    id: run?.id ?? randomUUID(),
    startedAt: run?.startedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    versionBefore: run?.versionBefore ?? null,
    versionAfter,
    expectedVersion: run?.expectedVersion ?? null,
    runnerPlatform: process.platform,
    runnerError,
    results,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
