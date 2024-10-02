//#FILE: test-fs-long-path.js
//#SHA1: 19cff71e86cbe8f8b5c34b3a6a811f76aebdbd92
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Skip this test if not on Windows
const isWindows = process.platform === 'win32';
if (!isWindows) {
  test.skip('this test is Windows-specific.', () => {});
} else {
  const tmpdir = path.join(os.tmpdir(), 'test-fs-long-path');

  beforeAll(() => {
    if (fs.existsSync(tmpdir)) {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpdir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('long path operations', async () => {
    // Make a path that will be at least 260 chars long.
    const fileNameLen = Math.max(260 - tmpdir.length - 1, 1);
    const fileName = path.join(tmpdir, 'x'.repeat(fileNameLen));
    const fullPath = path.resolve(fileName);

    console.log({
      filenameLength: fileName.length,
      fullPathLength: fullPath.length
    });

    await new Promise((resolve, reject) => {
      fs.writeFile(fullPath, 'ok', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await new Promise((resolve, reject) => {
      fs.stat(fullPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Tests https://github.com/nodejs/node/issues/39721
    await new Promise((resolve, reject) => {
      fs.realpath.native(fullPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Tests https://github.com/nodejs/node/issues/51031
    await expect(fs.promises.realpath(fullPath)).resolves.not.toThrow();
  });
}

//<#END_FILE: test-fs-long-path.js
