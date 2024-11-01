//#FILE: test-fs-watch-recursive-add-file-to-existing-subfolder.js
//#SHA1: 7d4414be8a9ba35f2ebdb685037951133137b6ef
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const testDir = path.join(os.tmpdir(), 'test-fs-watch-recursive-add-file-to-existing-subfolder');

beforeAll(() => {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('fs.watch detects file added to existing subfolder', (done) => {
  const rootDirectory = fs.mkdtempSync(path.join(testDir, 'test-'));
  const testDirectory = path.join(rootDirectory, 'test-4');
  fs.mkdirSync(testDirectory);

  const file = 'folder-5';
  const filePath = path.join(testDirectory, file);
  fs.mkdirSync(filePath);

  const subfolderPath = path.join(filePath, 'subfolder-6');
  fs.mkdirSync(subfolderPath);

  const childrenFile = 'file-7.txt';
  const childrenAbsolutePath = path.join(subfolderPath, childrenFile);
  const relativePath = path.join(file, path.basename(subfolderPath), childrenFile);

  const watcher = fs.watch(testDirectory, { recursive: true });
  let watcherClosed = false;

  watcher.on('change', (event, filename) => {
    expect(event).toBe('rename');

    if (filename === relativePath) {
      watcher.close();
      watcherClosed = true;
      expect(watcherClosed).toBe(true);
      done();
    }
  });

  // Do the write with a delay to ensure that the OS is ready to notify us.
  setTimeout(() => {
    fs.writeFileSync(childrenAbsolutePath, 'world');
  }, 200);
}, 10000); // Increased timeout to 10 seconds

//<#END_FILE: test-fs-watch-recursive-add-file-to-existing-subfolder.js
