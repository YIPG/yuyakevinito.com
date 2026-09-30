import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentGate, normalizedResults } from '../scripts/report-checks.mjs';

const version = '11111111-1111-4111-8111-111111111111';

test('public reporting strips private test errors, paths, and attachments', () => {
  const results = normalizedResults({
    suites: [{ specs: [{
      title: 'metadata',
      tests: [{
        projectName: 'webkit-desktop',
        annotations: [{ type: 'site-version', description: version }],
        results: [{ status: 'failed', duration: 12, error: { message: 'private-token-and-source-path' }, attachments: ['private'] }],
      }],
    }] }],
  });
  assert.equal(results.length, 16);
  assert.equal(results.find(result => result.scenario === 'metadata' && result.profile === 'webkit-desktop').outcome, 'failed');
  assert.equal(results.find(result => result.scenario === 'metadata' && result.profile === 'webkit-desktop').observedVersion, version);
  assert.doesNotMatch(JSON.stringify(results), /private|source|token|attachments/);
  assert.equal(results.filter(result => result.outcome === 'not_run').length, 15);
});

test('mixed browser versions stay unconfirmed and browser launch failures are incomplete', () => {
  const results = normalizedResults({ specs: [{
    title: 'metadata',
    tests: [{
      projectName: 'webkit-desktop',
      annotations: [{ type: 'site-version', description: version }, { type: 'site-version', description: 'missing' }],
      results: [{ status: 'failed', errors: [{ message: 'browserType.launch: Executable doesn\'t exist' }] }],
    }],
  }] });
  const result = results.find(item => item.scenario === 'metadata' && item.profile === 'webkit-desktop');
  assert.equal(result.observedVersion, null);
  assert.equal(result.outcome, 'not_run');
});

test('production events resolve the full suite instead of assuming a branch in the check-run payload', async () => {
  const event = {
    action: 'completed', repository: { id: 1391708243 },
    check_run: {
      app: { id: 85455 }, name: 'Workers Builds: yuyakevinito-com', conclusion: 'success',
      check_suite: { id: 123 }, output: { summary: `Version ID: ${version}` },
    },
  };
  let requested;
  const production = async url => {
    requested = url;
    return Response.json({ app: { id: 85455 }, head_branch: 'main' });
  };
  assert.deepEqual(await deploymentGate('check_run', event, production), { run: true, expectedVersion: version });
  assert.equal(requested, 'https://api.github.com/repos/YIPG/yuyakevinito.com/check-suites/123');
  assert.equal((await deploymentGate('check_run', event, async () =>
    Response.json({ app: { id: 85455 }, head_branch: 'preview' }))).run, false);
  assert.equal((await deploymentGate('check_run', { ...event, repository: { id: 1 } })).run, false);
  await assert.rejects(deploymentGate('check_run', event, async () => new Response(null, { status: 403 })), /HTTP 403/);
  await assert.rejects(deploymentGate('check_run', {
    ...event, check_run: { ...event.check_run, output: { summary: '' } },
  }, production), /no valid version/);
  assert.deepEqual(await deploymentGate('schedule', {}), { run: true, expectedVersion: null });
});
test('unknown and duplicate results fail instead of showing a successful fallback', () => {
  assert.throws(() => normalizedResults({ specs: [{ title: 'unknown' }] }), /Unexpected scenario/);
  assert.throws(() => normalizedResults({ specs: [{
    title: 'metadata',
    tests: [
      { projectName: 'webkit-desktop', results: [] },
      { projectName: 'webkit-desktop', results: [] },
    ],
  }] }), /Duplicate browser result/);
});
