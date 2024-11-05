//#FILE: test-fs-copyfile-respect-permissions.js
//#SHA1: 5a5d15dd2a31fab3f8cffa86fcaedc7dab528c9f
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const isWindows = process.platform === 'win32';
const isIBMi = process.platform === 'os400';

if (!isWindows && process.getuid() === 0) {
  it.skip('should not run as root', () => {});
} else if (isIBMi) {
  it.skip('IBMi has a different access permission mechanism', () => {});
} else {
  const tmpdir = path.join(os.tmpdir(), 'test-fs-copyfile-respect-permissions');

  beforeAll(() => {
    if (fs.existsSync(tmpdir)) {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpdir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  let n = 0;

  function beforeEach() {
    n++;
    const source = path.join(tmpdir, `source${n}`);
    const dest = path.join(tmpdir, `dest${n}`);
    fs.writeFileSync(source, 'source');
    fs.writeFileSync(dest, 'dest');
    fs.chmodSync(dest, '444');

    const check = (err) => {
      const expected = ['EACCES', 'EPERM'];
      expect(expected).toContain(err.code);
      expect(fs.readFileSync(dest, 'utf8')).toBe('dest');
      return true;
    };

    return { source, dest, check };
  }

  test('synchronous API', () => {
    const { source, dest, check } = beforeEach();
    expect(() => { fs.copyFileSync(source, dest); }).toThrow(expect.objectContaining({
      message: expect.any(String),
      code: expect.stringMatching(/^(EACCES|EPERM)$/)
    }));
  });

  test('promises API', async () => {
    const { source, dest, check } = beforeEach();
    await expect(fs.promises.copyFile(source, dest)).rejects.toThrow(expect.objectContaining({
      message: expect.any(String),
      code: expect.stringMatching(/^(EACCES|EPERM)$/)
    }));
  });

  test('callback API', (done) => {
    const { source, dest, check } = beforeEach();
    fs.copyFile(source, dest, (err) => {
      expect(check(err)).toBe(true);
      done();
    });
  });
}

//<#END_FILE: test-fs-copyfile-respect-permissions.js
