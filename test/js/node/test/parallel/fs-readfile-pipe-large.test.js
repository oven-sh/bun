//#FILE: test-fs-readfile-pipe-large.js
//#SHA1: 5e2fa068dc742cfe617ccf3f08df6725e92a51f6
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

const isWindows = process.platform === 'win32';
const isAIX = process.platform === 'aix';
const isIBMi = process.platform === 'os400';

const skipPlatforms = ['win32', 'aix', 'os400'];

// Separate child process logic
if (process.argv[2] === 'child') {
  fs.readFile('/dev/stdin', (err, data) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.stdout.write(data);
  });
} else {
  // Jest test code
  describe('fs.readFile pipe large', () => {
    const tmpdir = os.tmpdir();
    const filename = path.join(tmpdir, 'readfile_pipe_large_test.txt');
    const dataExpected = 'a'.repeat(999999);

    beforeAll(() => {
      if (!skipPlatforms.includes(process.platform)) {
        fs.writeFileSync(filename, dataExpected);
      }
    });

    afterAll(() => {
      if (!skipPlatforms.includes(process.platform)) {
        fs.unlinkSync(filename);
      }
    });

    test('should read from /dev/stdin and write to stdout', () => {
      if (skipPlatforms.includes(process.platform)) {
        return test.skip(`No /dev/stdin on ${process.platform}.`);
      }

      const f = JSON.stringify(__filename);
      const node = JSON.stringify(process.execPath);
      const cmd = `cat ${filename} | ${node} ${f} child`;

      return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1000000 }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }

          expect(stdout).toBe(dataExpected);
          expect(stderr).toBe('');
          resolve();
        });
      });
    });
  });
}
//<#END_FILE: test-fs-readfile-pipe-large.js
