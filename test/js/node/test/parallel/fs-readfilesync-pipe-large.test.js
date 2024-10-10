//#FILE: test-fs-readfilesync-pipe-large.js
//#SHA1: 669e419b344b375a028fa352c7a29eec2d5d52af
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');

const isWindows = process.platform === 'win32';
const isAIX = process.platform === 'aix';
const isIBMi = process.platform === 'os400';

const shouldSkip = isWindows || isAIX || isIBMi;

const tmpdir = os.tmpdir();

if (process.argv[2] === 'child') {
  process.stdout.write(fs.readFileSync('/dev/stdin', 'utf8'));
  process.exit(0);
}

describe('fs.readFileSync pipe large', () => {
  const filename = path.join(tmpdir, 'readfilesync_pipe_large_test.txt');
  const dataExpected = 'a'.repeat(999999);

  beforeAll(() => {
    if (!shouldSkip) {
      fs.writeFileSync(filename, dataExpected);
    }
  });

  afterAll(() => {
    if (!shouldSkip) {
      fs.unlinkSync(filename);
    }
  });

  const testFn = shouldSkip ? test.skip : test;

  testFn('should read large file through pipe', (done) => {
    const childScriptPath = path.join(__dirname, 'child-script.js');
    fs.writeFileSync(childScriptPath, `
      const fs = require('fs');
      process.stdout.write(fs.readFileSync('/dev/stdin', 'utf8'));
    `);

    const cmd = `cat ${filename} | "${process.execPath}" "${childScriptPath}"`;

    exec(cmd, { maxBuffer: 1000000 }, (error, stdout, stderr) => {
      try {
        expect(error).toBeNull();
        expect(stdout).toBe(dataExpected);
        expect(stderr).toBe('');
        fs.unlinkSync(childScriptPath);
        done();
      } catch (err) {
        fs.unlinkSync(childScriptPath);
        done(err);
      }
    });
  }, 30000); // Increase timeout to 30 seconds
});

//<#END_FILE: test-fs-readfilesync-pipe-large.js
