//#FILE: test-fs-open-no-close.js
//#SHA1: 3f09a04c65d9a376e5d9b82882d375ab1dc99ad9
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const debuglog = (arg) => {
  console.log(new Date().toLocaleString(), arg);
};

const tmpdir = path.join(os.tmpdir(), 'test-fs-open-no-close');

beforeAll(() => {
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test('fs.open should not keep the event loop open if file is not closed', (done) => {
  let openFd;

  fs.open(path.join(tmpdir, 'dummy'), 'wx+', (err, fd) => {
    debuglog('fs open() callback');
    expect(err).toBeFalsy();
    openFd = fd;
    done();
  });

  debuglog('waiting for callback');

  // Simulate process.on('beforeExit') behavior
  process.nextTick(() => {
    if (openFd) {
      fs.closeSync(openFd);
    }
  });
});

//<#END_FILE: test-fs-open-no-close.js
