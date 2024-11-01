//#FILE: test-fs-symlink-buffer-path.js
//#SHA1: 73fa7d9b492bd23730f1a8763caac92a9f4a1896
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const canCreateSymLink = () => {
  try {
    fs.symlinkSync('test-file', 'test-symlink');
    fs.unlinkSync('test-symlink');
    return true;
  } catch (err) {
    return false;
  }
};

if (!canCreateSymLink()) {
  test.skip('insufficient privileges', () => {});
} else {
  const tmpdir = path.join(os.tmpdir(), 'test-fs-symlink-buffer-path');
  const fixturesPath = path.join(__dirname, '..', 'fixtures');

  beforeAll(() => {
    if (fs.existsSync(tmpdir)) {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpdir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('creating and reading symbolic link', async () => {
    const linkData = path.join(fixturesPath, 'cycles', 'root.js');
    const linkPath = path.join(tmpdir, 'symlink1.js');

    fs.symlinkSync(Buffer.from(linkData), linkPath);

    const linkStats = await fs.promises.lstat(linkPath);
    const linkTime = linkStats.mtime.getTime();

    const fileStats = await fs.promises.stat(linkPath);
    const fileTime = fileStats.mtime.getTime();

    const destination = await fs.promises.readlink(linkPath);
    expect(destination).toBe(linkData);

    expect(linkTime).not.toBe(fileTime);
  });
}

//<#END_FILE: test-fs-symlink-buffer-path.js
