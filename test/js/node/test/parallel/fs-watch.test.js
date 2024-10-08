//#FILE: test-fs-watch.js
//#SHA1: 07373db00b057e796555cac6f75973e9e4358284
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const isIBMi = process.platform === 'os400';
const isLinux = process.platform === 'linux';
const isMacOS = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const isAIX = process.platform === 'aix';

if (isIBMi) {
  test.skip('IBMi does not support `fs.watch()`', () => {});
} else {
  const tmpdir = path.join(os.tmpdir(), 'test-fs-watch');

  class WatchTestCase {
    constructor(shouldInclude, dirName, fileName, field) {
      this.dirName = dirName;
      this.fileName = fileName;
      this.field = field;
      this.shouldSkip = !shouldInclude;
    }
    get dirPath() { return path.join(tmpdir, this.dirName); }
    get filePath() { return path.join(this.dirPath, this.fileName); }
  }

  const cases = [
    new WatchTestCase(
      isLinux || isMacOS || isWindows || isAIX,
      'watch1',
      'foo',
      'filePath'
    ),
    new WatchTestCase(
      isLinux || isMacOS || isWindows,
      'watch2',
      'bar',
      'dirPath'
    ),
  ];

  beforeAll(() => {
    if (fs.existsSync(tmpdir)) {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpdir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  function doWatchTest(testCase) {
    return new Promise((resolve, reject) => {
      let interval;
      const pathToWatch = testCase[testCase.field];
      const watcher = fs.watch(pathToWatch);
      
      watcher.on('error', (err) => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        reject(err);
      });

      watcher.on('change', (eventType, argFilename) => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
        if (isMacOS)
          expect(['rename', 'change'].includes(eventType)).toBe(true);
        else
          expect(eventType).toBe('change');
        expect(argFilename).toBe(testCase.fileName);

        watcher.close();
        watcher.close(); // Closing a closed watcher should be a noop
        resolve();
      });

      const content2 = Date.now() + testCase.fileName.toUpperCase().repeat(1e4);
      interval = setInterval(() => {
        fs.writeFileSync(testCase.filePath, '');
        fs.writeFileSync(testCase.filePath, content2);
      }, 100);
    });
  }

  test.each(cases.filter(testCase => !testCase.shouldSkip))(
    'Watch test for $dirName',
    async (testCase) => {
      fs.mkdirSync(testCase.dirPath, { recursive: true });
      const content1 = Date.now() + testCase.fileName.toLowerCase().repeat(1e4);
      fs.writeFileSync(testCase.filePath, content1);
      
      if (isMacOS) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      await doWatchTest(testCase);
    },
    30000 // Increase timeout to 30 seconds
  );

  test('fs.watch throws for invalid inputs', () => {
    [false, 1, {}, [], null, undefined].forEach((input) => {
      expect(() => fs.watch(input, () => {})).toThrow(expect.objectContaining({
        code: 'ERR_INVALID_ARG_TYPE',
        name: 'TypeError',
        message: expect.any(String)
      }));
    });
  });
}

//<#END_FILE: test-fs-watch.js
