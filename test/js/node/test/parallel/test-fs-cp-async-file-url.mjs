// This tests that it accepts file URL as src and dest.

import { mustCall, mustNotMutateObjectDeep } from '../common/index.mjs';
import assert from 'node:assert';
import { cp } from 'node:fs';
import { pathToFileURL } from 'node:url';
import tmpdir from '../common/tmpdir.js';
import { assertDirEquivalent, nextdir } from '../common/fs.js';
import fixtures from '../common/fixtures.js';

tmpdir.refresh();

// Bun: upstream uses a path relative to node's repo-root cwd; resolve the
// fixture explicitly so the test is independent of the runner's cwd.
const src = fixtures.path('copy/kitchen-sink');
const dest = nextdir();
cp(pathToFileURL(src), pathToFileURL(dest), mustNotMutateObjectDeep({ recursive: true }),
   mustCall((err) => {
     assert.strictEqual(err, null);
     assertDirEquivalent(src, dest);
   }));
