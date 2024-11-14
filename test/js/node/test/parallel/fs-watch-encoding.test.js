//#FILE: test-fs-watch-encoding.js
//#SHA1: 63f7e4008743417c7ee5995bbf16a28ade764e48
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpdir = path.join(os.tmpdir(), 'test-fs-watch-encoding');
const fn = '新建文夹件.txt';
const a = path.join(tmpdir, fn);

let interval;

beforeAll(() => {
  if (process.platform === 'aix') {
    return test.skip('folder watch capability is limited in AIX.');
  }
  if (process.platform === 'os400') {
    return test.skip('IBMi does not support `fs.watch()`');
  }
  
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  clearInterval(interval);
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

const watcherTests = [
  {
    name: 'with hex encoding',
    options: { encoding: 'hex' },
    expectedFilenames: ['e696b0e5bbbae69687e5a4b9e4bbb62e747874', null],
  },
  {
    name: 'without encoding option',
    options: {},
    expectedFilenames: [fn, null],
  },
  {
    name: 'with buffer encoding',
    options: { encoding: 'buffer' },
    expectedFilenames: [Buffer.from(fn), null],
  },
];

watcherTests.forEach(({ name, options, expectedFilenames }) => {
  test(`fs.watch ${name}`, (done) => {
    const watcher = fs.watch(tmpdir, options, (event, filename) => {
      if (expectedFilenames.some(expected => 
          expected instanceof Buffer 
            ? expected.equals(filename)
            : expected === filename)) {
        watcher.close();
        done();
      }
    });

    // Start the interval after setting up the watcher
    if (!interval) {
      interval = setInterval(() => {
        const fd = fs.openSync(a, 'w+');
        fs.closeSync(fd);
        fs.unlinkSync(a);
      }, 100);
    }
  }, 10000); // Increased timeout to allow for file operations
});

//<#END_FILE: test-fs-watch-encoding.js
