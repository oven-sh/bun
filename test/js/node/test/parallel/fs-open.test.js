//#FILE: test-fs-open.js
//#SHA1: 0466ad8882a3256fdd8da5fc8da3167f6dde4fd6
//-----------------
'use strict';
const fs = require('fs');
const path = require('path');

test('fs.openSync throws ENOENT for non-existent file', () => {
  expect(() => {
    fs.openSync('/8hvftyuncxrt/path/to/file/that/does/not/exist', 'r');
  }).toThrow(expect.objectContaining({
    code: 'ENOENT',
    message: expect.any(String)
  }));
});

test('fs.openSync succeeds for existing file', () => {
  expect(() => fs.openSync(__filename)).not.toThrow();
});

test('fs.open succeeds with various valid arguments', async () => {
  await expect(fs.promises.open(__filename)).resolves.toBeDefined();
  await expect(fs.promises.open(__filename, 'r')).resolves.toBeDefined();
  await expect(fs.promises.open(__filename, 'rs')).resolves.toBeDefined();
  await expect(fs.promises.open(__filename, 'r', 0)).resolves.toBeDefined();
  await expect(fs.promises.open(__filename, 'r', null)).resolves.toBeDefined();
});

test('fs.open throws for invalid mode argument', () => {
  expect(() => fs.open(__filename, 'r', 'boom', () => {})).toThrow(expect.objectContaining({
    code: 'ERR_INVALID_ARG_VALUE',
    name: 'TypeError',
    message: expect.any(String)
  }));
});

test('fs.open throws for invalid argument combinations', () => {
  const invalidArgs = [[], ['r'], ['r', 0], ['r', 0, 'bad callback']];
  invalidArgs.forEach(args => {
    expect(() => fs.open(__filename, ...args)).toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: expect.any(String)
    }));
  });
});

test('fs functions throw for invalid path types', () => {
  const invalidPaths = [false, 1, [], {}, null, undefined];
  invalidPaths.forEach(path => {
    expect(() => fs.open(path, 'r', () => {})).toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: expect.any(String)
    }));
    expect(() => fs.openSync(path, 'r')).toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: expect.any(String)
    }));
    expect(fs.promises.open(path, 'r')).rejects.toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      name: 'TypeError',
      message: expect.any(String)
    }));
  });
});

test('fs functions throw for invalid modes', () => {
  const invalidModes = [false, [], {}];
  invalidModes.forEach(mode => {
    expect(() => fs.open(__filename, 'r', mode, () => {})).toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      message: expect.any(String)
    }));
    expect(() => fs.openSync(__filename, 'r', mode)).toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      message: expect.any(String)
    }));
    expect(fs.promises.open(__filename, 'r', mode)).rejects.toThrow(expect.objectContaining({
      code: 'ERR_INVALID_ARG_TYPE',
      message: expect.any(String)
    }));
  });
});

//<#END_FILE: test-fs-open.js
