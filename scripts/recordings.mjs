import { pathToFileURL } from 'node:url';
import { encodeRecordings } from '../site-checks/shared/recordings.mjs';
export * from '../site-checks/shared/recordings.mjs';

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await encodeRecordings();
