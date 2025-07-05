'use strict';

// This tests that module.runMain can be monkey patched using --require.
// TODO(joyeecheung): This probably should be deprecated.

require('../common');
const { path } = require('../common/fixtures');
const assert = require('assert');
const { spawnSync } = require('child_process');

const child = spawnSync(process.execPath, [
  '--require',
  path('monkey-patch-run-main.js'),
  path('semicolon.js'),
]);

if (child.stderr.length > 0) console.error(child.stderr.toString("utf8"));
assert.strictEqual(child.status, 0);
assert(child.stdout.toString().includes('runMain is monkey patched!'));
