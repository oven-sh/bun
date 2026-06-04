'use strict';
const common = require('../common');
const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const tmpdir = require('../common/tmpdir');

function verifyStatFsObject(statfs, isBigint = false) {
  const valueType = isBigint ? 'bigint' : 'number';

  [
    'type', 'bsize', 'blocks', 'bfree', 'bavail', 'files', 'ffree',
  ].forEach((k) => {
    assert.ok(Object.hasOwn(statfs, k));
    assert.strictEqual(typeof statfs[k], valueType,
                       `${k} should be a ${valueType}`);
  });
}

fs.statfs(__filename, common.mustSucceed(function(stats) {
  verifyStatFsObject(stats);
  assert.strictEqual(this, undefined);
}));

fs.statfs(__filename, { bigint: true }, function(err, stats) {
  assert.ifError(err);
  verifyStatFsObject(stats, true);
  assert.strictEqual(this, undefined);
});

// Synchronous
{
  const statFsObj = fs.statfsSync(__filename);
  verifyStatFsObject(statFsObj);
}

// Synchronous Bigint
{
  const statFsBigIntObj = fs.statfsSync(__filename, { bigint: true });
  verifyStatFsObject(statFsBigIntObj, true);
}

{
  const statFsObj = fs.statfsSync(__filename);
  const statFsBigIntObj = fs.statfsSync(__filename, { bigint: true });

  [
    'type', 'bsize', 'blocks', 'bfree', 'bavail', 'files', 'ffree',
  ].forEach((k) => {
    if (Number.isSafeInteger(statFsObj[k]))
      assert.strictEqual(BigInt(statFsObj[k]), statFsBigIntObj[k]);
  });
}

if (common.isLinux) {
  tmpdir.refresh();
  const source = tmpdir.resolve('statfs-large-block-counts.c');
  const library = tmpdir.resolve('statfs-large-block-counts.so');

  fs.writeFileSync(source, `
#define _GNU_SOURCE
#define _LARGEFILE64_SOURCE
#include <string.h>
#include <sys/vfs.h>

static void fill_statfs(struct statfs *buf) {
  memset(buf, 0, sizeof(*buf));
  buf->f_type = 0x01021994;
  buf->f_bsize = 4096;
  buf->f_blocks = 3248532185ULL;
  buf->f_bfree = 3248532186ULL;
  buf->f_bavail = 3248532185ULL;
  buf->f_files = 1000;
  buf->f_ffree = 999;
}

int statfs(const char *path, struct statfs *buf) {
  fill_statfs(buf);
  return 0;
}

#ifdef __GLIBC__
static void fill_statfs64(struct statfs64 *buf) {
  memset(buf, 0, sizeof(*buf));
  buf->f_type = 0x01021994;
  buf->f_bsize = 4096;
  buf->f_blocks = 3248532185ULL;
  buf->f_bfree = 3248532186ULL;
  buf->f_bavail = 3248532185ULL;
  buf->f_files = 1000;
  buf->f_ffree = 999;
}

int statfs64(const char *path, struct statfs64 *buf) {
  fill_statfs64(buf);
  return 0;
}
#endif
`);

  const cc = childProcess.spawnSync('cc', [
    '-shared',
    '-fPIC',
    source,
    '-o',
    library,
  ], { encoding: 'utf8' });
  assert.ifError(cc.error);
  assert.strictEqual(cc.status, 0, cc.stderr);

  const child = childProcess.spawnSync(process.execPath, [
    '-e',
    `
      const assert = require('node:assert');
      const fs = require('node:fs');

      function verifyNumberStats(stats) {
        assert.strictEqual(typeof stats.blocks, 'number');
        assert.strictEqual(typeof stats.bfree, 'number');
        assert.strictEqual(typeof stats.bavail, 'number');
        assert.strictEqual(stats.blocks, 3248532185);
        assert.strictEqual(stats.bfree, 3248532186);
        assert.strictEqual(stats.bavail, 3248532185);
        assert.ok(stats.bavail > 0);
      }

      function verifyBigIntStats(stats) {
        assert.strictEqual(typeof stats.bavail, 'bigint');
        assert.strictEqual(stats.blocks, 3248532185n);
        assert.strictEqual(stats.bfree, 3248532186n);
        assert.strictEqual(stats.bavail, 3248532185n);
      }

      verifyNumberStats(fs.statfsSync(__filename));
      verifyBigIntStats(fs.statfsSync(__filename, { bigint: true }));
      fs.statfs(__filename, (err, stats) => {
        assert.ifError(err);
        verifyNumberStats(stats);
      });
      fs.statfs(__filename, { bigint: true }, (err, stats) => {
        assert.ifError(err);
        verifyBigIntStats(stats);
      });
    `,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: '1',
      LD_PRELOAD: [library, process.env.LD_PRELOAD].filter(Boolean).join(path.delimiter),
    },
  });
  assert.ifError(child.error);
  assert.strictEqual(child.status, 0, child.stderr);
}

[false, 1, {}, [], null, undefined].forEach((input) => {
  assert.throws(
    () => fs.statfs(input, common.mustNotCall()),
    {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError'
    }
  );
  assert.throws(
    () => fs.statfsSync(input),
    {
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError'
    }
  );
});

// Should not throw an error
fs.statfs(__filename, undefined, common.mustCall());
