import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Never include response contents in public Actions logs.
export function assertAnonymousJournal(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Anonymous journal probe returned invalid JSON');
  }
  if (!Array.isArray(value) || value.length !== 0) {
    throw new Error('Anonymous journal probe did not return an empty array');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const path = process.argv[2];
    if (!path || process.argv.length !== 3 || (await stat(path)).size > 65536) {
      throw new Error('Invalid anonymous journal probe file');
    }
    assertAnonymousJournal(await readFile(path, 'utf8'));
    console.log('Anonymous journal isolation verified');
  } catch {
    console.error('Anonymous journal isolation check failed; response contents withheld');
    process.exitCode = 1;
  }
}
