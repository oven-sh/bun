//#FILE: test-fs-readfile-pipe.js
//#SHA1: b78e6ea1bbcdaf74b6363f4740bdf2393ed28938
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const isWindows = process.platform === 'win32';
const isAIX = process.platform === 'aix';
const isIBMi = process.platform === 'os400';

const fixturesPath = path.join(__dirname, '..', 'fixtures');

if (isWindows || isAIX || isIBMi) {
  test.skip(`No /dev/stdin on ${process.platform}.`, () => {});
} else {
  if (process.argv[2] === 'child') {
    fs.readFile('/dev/stdin', (err, data) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      process.stdout.write(data);
    });
  } else {
    test('readFile pipe test', (done) => {
      const filename = path.join(fixturesPath, 'readfile_pipe_test.txt');
      const dataExpected = fs.readFileSync(filename, 'utf8');

      const f = JSON.stringify(__filename);
      const node = JSON.stringify(process.execPath);
      const cmd = `cat ${filename} | ${node} ${f} child`;

      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          done(error);
          return;
        }
        try {
          expect(stdout).toBe(dataExpected);
          expect(stderr).toBe('');
          done();
        } catch (error) {
          done(error);
        }
      });
    }, 10000); // Increase timeout to 10 seconds
  }
}

//<#END_FILE: test-fs-readfile-pipe.js
