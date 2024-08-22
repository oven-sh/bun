//#FILE: test-fs-watch-recursive-symlink.js
//#SHA1: 26750d4d5370711752ab57e6c097897fbd71e0aa
//-----------------
'use strict';

const { setTimeout } = require('timers/promises');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isIBMi = os.platform() === 'os400';
const isAIX = os.platform() === 'aix';

if (isIBMi) {
  test.skip('IBMi does not support `fs.watch()`');
}

// fs-watch on folders have limited capability in AIX.
// The testcase makes use of folder watching, and causes
// hang. This behavior is documented. Skip this for AIX.

if (isAIX) {
  test.skip('folder watch capability is limited in AIX.');
}

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));

beforeEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Add a recursive symlink to the parent folder', async () => {
  const testDirectory = fs.mkdtempSync(testDir + path.sep);

  // Do not use `testDirectory` as base. It will hang the tests.
  const rootDirectory = path.join(testDirectory, 'test-1');
  fs.mkdirSync(rootDirectory);

  const filePath = path.join(rootDirectory, 'file.txt');

  const symlinkFolder = path.join(rootDirectory, 'symlink-folder');
  fs.symlinkSync(rootDirectory, symlinkFolder);

  const watcher = fs.watch(rootDirectory, { recursive: true });
  let watcherClosed = false;
  
  const watcherPromise = new Promise((resolve) => {
    watcher.on('change', function(event, filename) {
      expect(event).toBe('rename');
      expect([path.basename(symlinkFolder), path.basename(filePath)]).toContain(filename);

      if (filename === path.basename(filePath)) {
        watcher.close();
        watcherClosed = true;
        resolve();
      }
    });
  });

  await setTimeout(100);
  fs.writeFileSync(filePath, 'world');

  await watcherPromise;
  expect(watcherClosed).toBe(true);
});

test('Symlink to outside the tracking folder can trigger change', async () => {
  const rootDirectory = fs.mkdtempSync(testDir + path.sep);

  const subDirectory = path.join(rootDirectory, 'sub-directory');
  fs.mkdirSync(subDirectory);

  const trackingSubDirectory = path.join(subDirectory, 'tracking-folder');
  fs.mkdirSync(trackingSubDirectory);

  const symlinkFolder = path.join(trackingSubDirectory, 'symlink-folder');
  fs.symlinkSync(subDirectory, symlinkFolder);

  const forbiddenFile = path.join(subDirectory, 'forbidden.txt');
  const acceptableFile = path.join(trackingSubDirectory, 'acceptable.txt');

  const watcher = fs.watch(trackingSubDirectory, { recursive: true });
  let watcherClosed = false;
  
  const watcherPromise = new Promise((resolve) => {
    watcher.on('change', function(event, filename) {
      // macOS will only change the following events:
      // { event: 'rename', filename: 'symlink-folder' }
      // { event: 'rename', filename: 'acceptable.txt' }
      expect(event).toBe('rename');
      expect([path.basename(symlinkFolder), path.basename(acceptableFile)]).toContain(filename);

      if (filename === path.basename(acceptableFile)) {
        watcher.close();
        watcherClosed = true;
        resolve();
      }
    });
  });

  await setTimeout(100);
  fs.writeFileSync(forbiddenFile, 'world');
  await setTimeout(100);
  fs.writeFileSync(acceptableFile, 'acceptable');

  await watcherPromise;
  expect(watcherClosed).toBe(true);
});

//<#END_FILE: test-fs-watch-recursive-symlink.js
