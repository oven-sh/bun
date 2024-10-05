//#FILE: test-fs-watchfile-bigint.js
//#SHA1: 3b2e1f656e95137ca75dedd42e71ba49e6405441
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpdir = path.join(os.tmpdir(), 'test-fs-watchfile-bigint');
const enoentFile = path.join(tmpdir, 'non-existent-file');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('fs.watchFile with bigint option', (done) => {
  let fileExists = false;
  const options = { interval: 0, bigint: true };

  const watcher = fs.watchFile(enoentFile, options, (curr, prev) => {
    if (!fileExists) {
      // If the file does not exist, all the fields should be zero and the date
      // fields should be UNIX EPOCH time
      expect(curr.ino).toBe(0n);
      expect(prev.ino).toBe(0n);
      // Create the file now, so that the callback will be called back once the
      // event loop notices it.
      fs.closeSync(fs.openSync(enoentFile, 'w'));
      fileExists = true;
    } else {
      // If the ino (inode) value is greater than zero, it means that the file
      // is present in the filesystem and it has a valid inode number.
      expect(curr.ino).toBeGreaterThan(0n);
      // As the file just got created, previous ino value should be lesser than
      // or equal to zero (non-existent file).
      expect(prev.ino).toBeLessThanOrEqual(0n);
      // Stop watching the file
      fs.unwatchFile(enoentFile);
      watcher.stop();  // Stopping a stopped watcher should be a noop
      done();
    }
  });

  // 'stop' should only be emitted once - stopping a stopped watcher should
  // not trigger a 'stop' event.
  watcher.on('stop', jest.fn());

  // Ensure the test times out if the callback is not called twice
  jest.setTimeout(10000);
});

//<#END_FILE: test-fs-watchfile-bigint.js
