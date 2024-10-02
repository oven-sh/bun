//#FILE: test-fs-write-file-invalid-path.js
//#SHA1: 7c9bb2489a084074e93221d201a6d62ca46cd840
//-----------------
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const isWindows = process.platform === 'win32';

if (!isWindows) {
  test.skip('This test is for Windows only.', () => {});
} else {
  const tmpdir = path.join(os.tmpdir(), 'test-fs-write-file-invalid-path');
  const DATA_VALUE = 'hello';

  // Refs: https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx
  // Ignore '/', '\\' and ':'
  const RESERVED_CHARACTERS = '<>"|?*';

  beforeAll(() => {
    if (fs.existsSync(tmpdir)) {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpdir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('writing files with reserved characters in name', () => {
    [...RESERVED_CHARACTERS].forEach((ch) => {
      const pathname = path.join(tmpdir, `somefile_${ch}`);
      expect(() => {
        fs.writeFileSync(pathname, DATA_VALUE);
      }).toThrow(/^Error: ENOENT: no such file or directory, open '.*'$/);
    });
  });

  test('writing and reading file with colon in name (NTFS data streams)', (done) => {
    const pathname = path.join(tmpdir, 'foo:bar');
    fs.writeFileSync(pathname, DATA_VALUE);

    let content = '';
    const fileDataStream = fs.createReadStream(pathname, {
      encoding: 'utf8'
    });

    fileDataStream.on('data', (data) => {
      content += data;
    });

    fileDataStream.on('end', () => {
      expect(content).toBe(DATA_VALUE);
      done();
    });
  });
}

//<#END_FILE: test-fs-write-file-invalid-path.js
