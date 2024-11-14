//#FILE: test-fs-watch-abort-signal.js
//#SHA1: 6f0b7fcc2f597faa8e1353559d5d007cd744614a
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const isIBMi = process.platform === 'os400';

if (isIBMi) {
  test.skip('IBMi does not support `fs.watch()`', () => {});
} else {
  const tmpdir = path.join(os.tmpdir(), 'test-fs-watch-abort-signal');
  const emptyFile = path.join(tmpdir, 'empty.js');

  beforeAll(() => {
    if (fs.existsSync(tmpdir)) {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpdir, { recursive: true });
    fs.writeFileSync(emptyFile, '');
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('Signal aborted after creating the watcher', (done) => {
    const ac = new AbortController();
    const { signal } = ac;
    const watcher = fs.watch(emptyFile, { signal });
    watcher.once('close', () => {
      done();
    });
    setImmediate(() => ac.abort());
  });

  test('Signal aborted before creating the watcher', (done) => {
    const signal = AbortSignal.abort();
    const watcher = fs.watch(emptyFile, { signal });
    watcher.once('close', () => {
      done();
    });
  });
}

//<#END_FILE: test-fs-watch-abort-signal.js
