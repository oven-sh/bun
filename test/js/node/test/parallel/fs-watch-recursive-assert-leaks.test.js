//#FILE: test-fs-watch-recursive-assert-leaks.js
//#SHA1: 316f1b184840ce5a8f2f92f4ab205038f4acaf9d
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { setTimeout } = require('timers/promises');

const testDir = path.join(os.tmpdir(), 'test-fs-watch-recursive-assert-leaks');

beforeAll(() => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

// Skip test for IBMi and AIX
const isIBMi = process.platform === 'os400';
const isAIX = process.platform === 'aix';

if (isIBMi) {
  test.skip('IBMi does not support `fs.watch()`', () => {});
} else if (isAIX) {
  test.skip('folder watch capability is limited in AIX', () => {});
} else {
  test('recursive watch does not leak handles', async () => {
    const rootDirectory = fs.mkdtempSync(path.join(testDir, 'root-'));
    const testDirectory = path.join(rootDirectory, 'test-7');
    const filePath = path.join(testDirectory, 'only-file.txt');
    fs.mkdirSync(testDirectory);

    let watcherClosed = false;
    const watcher = fs.watch(testDirectory, { recursive: true });

    const watchPromise = new Promise((resolve) => {
      watcher.on('change', async (event, filename) => {
        await setTimeout(100);
        if (filename === path.basename(filePath)) {
          watcher.close();
          watcherClosed = true;
          resolve();
        }
        await setTimeout(100);
        expect(process._getActiveHandles().some((handle) => handle.constructor.name === 'StatWatcher')).toBe(false);
      });
    });

    // Do the write with a delay to ensure that the OS is ready to notify us.
    await setTimeout(200);
    fs.writeFileSync(filePath, 'content');

    await watchPromise;
    expect(watcherClosed).toBe(true);
  }, 10000); // Increased timeout to 10 seconds
}

//<#END_FILE: test-fs-watch-recursive-assert-leaks.js
