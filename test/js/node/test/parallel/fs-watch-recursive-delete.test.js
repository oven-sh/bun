//#FILE: test-fs-watch-recursive-delete.js
//#SHA1: 00ca669f5bbedc8645a0e2ab48bd2f4200ab8175
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpdir = path.join(os.tmpdir(), 'test-fs-watch-recursive-delete');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

// Skip test for SunOS and IBMi
const isSunOS = os.platform() === 'sunos';
const isIBMi = os.platform() === 'aix' && os.type() === 'OS400';

if (isSunOS || isIBMi) {
  test.skip('SunOS behaves differently or IBMi does not support `fs.watch()`', () => {});
} else {
  test('fs.watch recursive delete', (done) => {
    const parentDir = path.join(tmpdir, 'parent');
    const childDir = path.join(parentDir, 'child');
    const testFile = path.join(childDir, 'test.tmp');

    fs.mkdirSync(childDir, { recursive: true });
    fs.writeFileSync(testFile, 'test');

    const onFileUpdate = jest.fn((eventType, filename) => {
      // We are only checking for the filename to avoid having Windows, Linux and Mac specific assertions
      if (fs.readdirSync(parentDir).length === 0) {
        watcher.close();
        expect(onFileUpdate).toHaveBeenCalled();
        done();
      }
    });

    const watcher = fs.watch(parentDir, { recursive: true }, onFileUpdate);

    // We must wait a bit for `fs.rm()` to let the watcher be set up properly
    setTimeout(() => {
      fs.rm(childDir, { recursive: true }, (err) => {
        expect(err).toBeNull();
      });
    }, 500);
  }, 10000); // Increase timeout to 10 seconds
}

//<#END_FILE: test-fs-watch-recursive-delete.js
