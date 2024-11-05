//#FILE: test-fs-watch-recursive-update-file.js
//#SHA1: d197449fc5f430b9ce49e7f75b57a44dd4f2259a
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const testDir = path.join(os.tmpdir(), 'test-fs-watch-recursive-update-file');

beforeAll(() => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Watch a folder and update an already existing file in it', (done) => {
  const rootDirectory = fs.mkdtempSync(path.join(testDir, 'test-'));
  const testDirectory = path.join(rootDirectory, 'test-0');
  fs.mkdirSync(testDirectory);

  const testFile = path.join(testDirectory, 'file-1.txt');
  fs.writeFileSync(testFile, 'hello');

  const watcher = fs.watch(testDirectory, { recursive: true });
  
  watcher.on('change', (event, filename) => {
    expect(event === 'change' || event === 'rename').toBe(true);

    if (filename === path.basename(testFile)) {
      watcher.close();
      done();
    }
  });

  // Do the write with a delay to ensure that the OS is ready to notify us.
  setTimeout(() => {
    fs.writeFileSync(testFile, 'hello');
  }, 200);
}, 10000); // Increased timeout to allow for file system operations

//<#END_FILE: test-fs-watch-recursive-update-file.js
