//#FILE: test-fs-readfilesync-enoent.js
//#SHA1: 6b71afe6d8461416367e54d6dff484298373e21a
//-----------------
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// This test is only relevant on Windows.
const isWindows = process.platform === 'win32';

if (!isWindows) {
  test.skip('Windows specific test.', () => {});
} else {
  // This test ensures fs.realpathSync works on properly on Windows without
  // throwing ENOENT when the path involves a fileserver.
  // https://github.com/nodejs/node-v0.x-archive/issues/3542

  function testPath(p) {
    test(`realpathSync for ${p}`, () => {
      const result = fs.realpathSync(p);
      expect(result.toLowerCase()).toBe(path.resolve(p).toLowerCase());
    });

    test(`realpath for ${p}`, (done) => {
      fs.realpath(p, (err, result) => {
        expect(err).toBeNull();
        expect(result.toLowerCase()).toBe(path.resolve(p).toLowerCase());
        done();
      });
    });
  }

  testPath(`//${os.hostname()}/c$/Windows/System32`);
  testPath(`//${os.hostname()}/c$/Windows`);
  testPath(`//${os.hostname()}/c$/`);
  testPath(`\\\\${os.hostname()}\\c$\\`);
  testPath('C:\\');
  testPath('C:');
  testPath(process.env.windir);
}

//<#END_FILE: test-fs-readfilesync-enoent.js
