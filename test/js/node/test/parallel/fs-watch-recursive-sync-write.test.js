//#FILE: test-fs-watch-recursive-sync-write.js
//#SHA1: 436087aa83502744252800b9a93dbe88a4ca3822
//-----------------
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('os');

const tmpDir = path.join(os.tmpdir(), 'test-fs-watch-recursive-sync-write');
const filename = path.join(tmpDir, 'test.file');

beforeAll(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Skip test for IBMi and AIX
const isIBMi = process.platform === 'os400';
const isAIX = process.platform === 'aix';

if (isIBMi) {
  test.skip('IBMi does not support `fs.watch()`', () => {});
} else if (isAIX) {
  test.skip('folder watch capability is limited in AIX', () => {});
} else {
  test('fs.watch detects file creation with recursive option', (done) => {
    const timeout = setTimeout(() => {
      done(new Error('timed out'));
    }, 30000);

    function doWatch() {
      const watcher = fs.watch(tmpDir, { recursive: true }, (eventType, _filename) => {
        clearTimeout(timeout);
        watcher.close();
        expect(eventType).toBe('rename');
        expect(path.join(tmpDir, _filename)).toBe(filename);
        done();
      });

      // Do the write with a delay to ensure that the OS is ready to notify us.
      setTimeout(() => {
        fs.writeFileSync(filename, 'foobar2');
      }, 200);
    }

    if (process.platform === 'darwin') {
      // On macOS delay watcher start to avoid leaking previous events.
      // Refs: https://github.com/libuv/libuv/pull/4503
      setTimeout(doWatch, 100);
    } else {
      doWatch();
    }
  }, 35000); // Increase timeout to account for the 30 second timeout in the test
}

//<#END_FILE: test-fs-watch-recursive-sync-write.js
