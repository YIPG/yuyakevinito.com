import { pathToFileURL } from 'node:url';
import { runCli } from '../site-checks/shared/report.mjs';
export { deploymentGate, normalizedResults, profiles } from '../site-checks/shared/report.mjs';

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await runCli();
