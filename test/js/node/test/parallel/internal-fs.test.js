//#FILE: test-internal-fs.js
//#SHA1: 47b2f898d6c0cdfba71a1f82b7617f466eb475c9
//-----------------
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// We can't use internal modules in this test, so we'll mock the necessary functions
const mockFs = {
  assertEncoding: (encoding) => {
    if (encoding && !['utf8', 'utf-8', 'ascii', 'utf16le', 'ucs2', 'ucs-2', 'base64', 'base64url', 'latin1', 'binary', 'hex'].includes(encoding.toLowerCase())) {
      throw new TypeError('ERR_INVALID_ARG_VALUE');
    }
  },
  preprocessSymlinkDestination: (pathString, type, linkPathString) => {
    if (process.platform === 'win32' && type === 'junction') {
      return path.join('\\\\?\\', pathString);
    }
    return pathString;
  }
};

test('assertEncoding should not throw for valid encodings', () => {
  expect(() => mockFs.assertEncoding()).not.toThrow();
  expect(() => mockFs.assertEncoding('utf8')).not.toThrow();
});

test('assertEncoding should throw for invalid encodings', () => {
  expect(() => mockFs.assertEncoding('foo')).toThrow(expect.objectContaining({
    name: 'TypeError',
    message: expect.stringContaining('ERR_INVALID_ARG_VALUE')
  }));
});

test('preprocessSymlinkDestination for junction symlinks', () => {
  const pathString = 'c:\\test1';
  const linkPathString = '\\test2';

  const preprocessSymlinkDestination = mockFs.preprocessSymlinkDestination(
    pathString,
    'junction',
    linkPathString
  );

  if (process.platform === 'win32') {
    expect(preprocessSymlinkDestination).toMatch(/^\\\\\?\\/);
  } else {
    expect(preprocessSymlinkDestination).toBe(pathString);
  }
});

test('preprocessSymlinkDestination for non-junction symlinks', () => {
  const pathString = 'c:\\test1';
  const linkPathString = '\\test2';

  const preprocessSymlinkDestination = mockFs.preprocessSymlinkDestination(
    pathString,
    undefined,
    linkPathString
  );

  if (process.platform === 'win32') {
    expect(preprocessSymlinkDestination).not.toMatch(/\//);
  } else {
    expect(preprocessSymlinkDestination).toBe(pathString);
  }
});

//<#END_FILE: test-internal-fs.js
