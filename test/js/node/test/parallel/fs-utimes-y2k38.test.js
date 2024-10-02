//#FILE: test-fs-utimes-y2K38.js
//#SHA1: dc6922ab5977439382d897b46a60065632e81fce
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const tmpdir = path.join(os.tmpdir(), 'test-fs-utimes-y2K38');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

// Check for Y2K38 support. For Windows, assume it's there.
if (!process.platform === 'win32') {
  const testFilePath = path.join(tmpdir, 'y2k38-test');
  const testFileDate = '204001020304';

  test('Y2K38 support check', () => {
    const touchResult = spawnSync('touch', ['-t', testFileDate, testFilePath], { encoding: 'utf8' });
    if (touchResult.status !== 0) {
      return; // Skip the test if touch fails
    }

    const dateResult = spawnSync('date', ['-r', testFilePath, '+%Y%m%d%H%M'], { encoding: 'utf8' });
    if (dateResult.status === 0) {
      if (dateResult.stdout.trim() !== testFileDate) {
        return; // Skip the test if date doesn't match
      }
    } else {
      expect(dateResult.stderr).toMatch(/[Uu]sage:/);
    }
  });
}

test('utimes precision', () => {
  const filePath = path.join(tmpdir, 'test-utimes-precision');
  fs.writeFileSync(filePath, '');

  const Y2K38_mtime = 2 ** 31;
  fs.utimesSync(filePath, Y2K38_mtime, Y2K38_mtime);
  const Y2K38_stats = fs.statSync(filePath);
  expect(Y2K38_stats.mtime.getTime() / 1000).toBe(Y2K38_mtime);
});

if (process.platform === 'win32') {
  test('Windows-specific utimes tests', () => {
    const filePath = path.join(tmpdir, 'test-utimes-precision');

    // Truncate mtime test
    const truncate_mtime = 1713037251360;
    fs.utimesSync(filePath, truncate_mtime / 1000, truncate_mtime / 1000);
    const truncate_stats = fs.statSync(filePath);
    expect(truncate_stats.mtime.getTime()).toBe(truncate_mtime);

    // Overflow mtime test
    const overflow_mtime = 2159345162531;
    fs.utimesSync(filePath, overflow_mtime / 1000, overflow_mtime / 1000);
    const overflow_stats = fs.statSync(filePath);
    expect(overflow_stats.mtime.getTime()).toBe(overflow_mtime);
  });
}

//<#END_FILE: test-fs-utimes-y2K38.js
