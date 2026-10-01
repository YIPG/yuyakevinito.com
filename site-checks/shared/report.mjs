// Generated from YIPG/health runner/shared; edit the source and resync.
import { createHmac, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { settings, profiles } from './settings.mjs';
import { uploadRecordings } from './recordings.mjs';

export { profiles };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const directory = () => resolve('.site-checks');

export async function deploymentGate(eventName, event, fetcher = fetch, site = settings()) {
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') return { run: true, expectedVersion: null };
  const check = event.check_run;
  if (eventName !== 'check_run' || event.repository?.id !== site.repositoryId || event.action !== 'completed'
    || check?.app?.id !== 85455 || check.name !== `Workers Builds: ${site.worker}` || check.conclusion !== 'success') {
    return { run: false, expectedVersion: null };
  }
  if (!Number.isSafeInteger(check.check_suite?.id)) throw new Error('Missing deployment suite');
  const response = await fetcher(`https://api.github.com/repos/${site.repository}/check-suites/${check.check_suite.id}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Could not resolve deployment branch: HTTP ${response.status}`);
  const suite = await response.json();
  if (suite.app?.id !== 85455 || suite.head_branch !== 'main') return { run: false, expectedVersion: null };
  const version = check.output?.summary?.match(/Version ID:\s*([a-f0-9-]{36})/i)?.[1];
  if (!version || !uuid.test(version)) throw new Error('Deployment notification has no valid version');
  return { run: true, expectedVersion: version.toLowerCase() };
}

export function normalizedResults(report, site = settings()) {
  const found = new Map();
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      if (!site.scenarioIds.includes(spec.title)) throw new Error('Unexpected scenario');
      for (const test of spec.tests ?? []) {
        if (!profiles.includes(test.projectName)) throw new Error('Unexpected browser profile');
        const key = `${spec.title}:${test.projectName}`;
        if (found.has(key)) throw new Error('Duplicate browser result');
        const result = test.results?.at(-1);
        const versions = (result?.annotations ?? test.annotations ?? [])
          .filter(item => item.type === 'site-version').map(item => item.description);
        const observedVersion = versions.length && versions.every(value => typeof value === 'string' && uuid.test(value)
          && value.toLowerCase() === versions[0].toLowerCase()) ? versions[0].toLowerCase() : null;
        const launchError = result?.errors?.some(error => /browserType\.launch|Executable doesn't exist/.test(error.message ?? ''));
        const outcome = result?.status === 'passed' ? 'passed'
          : !launchError && ['failed', 'timedOut'].includes(result?.status) ? 'failed' : 'not_run';
        found.set(key, {
          scenario: spec.title, profile: test.projectName, outcome, observedVersion,
          durationMs: Math.max(0, Math.round(result?.duration ?? 0)),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(report);
  return site.scenarioIds.flatMap(scenario => profiles.map(profile =>
    found.get(`${scenario}:${profile}`) ?? { scenario, profile, outcome: 'not_run', durationMs: 0, observedVersion: null }));
}

async function liveVersion(site) {
  const response = await fetch(site.url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
  const version = response.headers.get('X-Site-Version');
  await response.body?.cancel();
  if (response.status !== 200 || !version || !uuid.test(version)) throw new Error('Production version could not be confirmed');
  return version.toLowerCase();
}

async function createReport(site) {
  let run;
  let report;
  let runnerError = false;
  for (const [name, assign] of [
    ['run.json', value => { run = value; }], ['playwright.json', value => { report = value; }],
  ]) {
    try { assign(JSON.parse(await readFile(resolve(directory(), name), 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.error(`Missing ${name}; the run is incomplete.`);
      runnerError = true;
    }
  }
  let versionAfter = null;
  try { versionAfter = await liveVersion(site); }
  catch (error) { console.error(error.message); runnerError = true; }
  const results = normalizedResults(report ?? {}, site);
  runnerError ||= results.some(result => result.outcome === 'not_run') || Boolean(report?.errors?.length);
  return {
    schemaVersion: 1, siteId: site.id, id: run?.id ?? randomUUID(),
    startedAt: run?.startedAt ?? new Date().toISOString(), finishedAt: new Date().toISOString(),
    versionBefore: run?.versionBefore ?? null, versionAfter, expectedVersion: run?.expectedVersion ?? null,
    runnerPlatform: process.platform, runnerError, results,
  };
}

export async function runCli(command = process.argv[2]) {
  const site = settings();
  if (command === 'gate') {
    const gate = await deploymentGate(process.env.GITHUB_EVENT_NAME, JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')));
    await appendFile(process.env.GITHUB_OUTPUT, `run=${gate.run}\nexpected-version=${gate.expectedVersion ?? ''}\n`);
    console.log(gate.run ? 'Production run approved.' : 'Not a production deployment; skipped.');
    return;
  }
  if (command === 'prepare') {
    await mkdir(directory(), { recursive: true });
    for (const file of ['run.json', 'report.json', 'playwright.json', 'recordings.json']) await rm(resolve(directory(), file), { force: true });
    const expectedVersion = process.env.EXPECTED_SITE_VERSION || null;
    if (expectedVersion && !uuid.test(expectedVersion)) throw new Error('Invalid expected version');
    const run = { id: randomUUID(), startedAt: new Date().toISOString(), versionBefore: null, expectedVersion };
    try { run.versionBefore = await liveVersion(site); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    await writeFile(resolve(directory(), 'run.json'), JSON.stringify(run));
    return;
  }
  if (command !== 'publish') throw new Error('Use gate, prepare, or publish');
  const secret = process.env.SITE_CHECKS_SECRET;
  if (!secret) throw new Error('SITE_CHECKS_SECRET is not configured');
  let body;
  try { body = await readFile(resolve(directory(), 'report.json'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (body === undefined) {
    await mkdir(directory(), { recursive: true });
    const payload = await createReport(site);
    try {
      payload.recordings = await uploadRecordings(payload.id, secret);
      if (payload.recordings.length !== site.scenarioIds.length) throw new Error('Some recordings are missing');
    } catch (error) {
      console.error(`Recordings unavailable: ${error.message}`);
      payload.recordingError = true;
      process.exitCode = 1;
    }
    body = JSON.stringify(payload);
    await writeFile(resolve(directory(), 'report.json'), body);
  }
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const response = await fetch(`https://health.yuyakevinito.com/api/checks/${site.id}`, {
    method: 'POST', body, signal: AbortSignal.timeout(30_000),
    headers: { 'Content-Type': 'application/json', 'X-Site-Checks-Signature': signature },
  });
  await response.body?.cancel();
  if (response.status !== 200) throw new Error(`Report rejected: HTTP ${response.status}`);
  const payload = JSON.parse(body);
  if (payload.recordingError) process.exitCode = 1;
  console.log(`Published ${payload.results.length} browser results for ${site.id}.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await runCli();
