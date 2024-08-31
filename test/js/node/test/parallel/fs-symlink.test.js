//#FILE: test-fs-symlink.js
//#SHA1: 4861a453e314d789a1b933d7179da96b7a35378c
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const canCreateSymLink = () => {
  try {
    fs.symlinkSync("", "");
    fs.unlinkSync("");
    return true;
  } catch (e) {
    return false;
  }
};

if (!canCreateSymLink()) {
  it.skip("insufficient privileges", () => {});
} else {
  let linkTime;
  let fileTime;
  const tmpdir = os.tmpdir();

  beforeEach(() => {
    jest.spyOn(fs, "symlink");
    jest.spyOn(fs, "lstat");
    jest.spyOn(fs, "stat");
    jest.spyOn(fs, "readlink");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Test creating and reading symbolic link", async () => {
    const linkData = path.resolve(__dirname, "../fixtures/cycles/root.js");
    const linkPath = path.resolve(tmpdir, "symlink1.js");

    await new Promise(resolve => {
      fs.symlink(linkData, linkPath, resolve);
    });

    expect(fs.symlink).toHaveBeenCalled();

    await new Promise(resolve => {
      fs.lstat(linkPath, (err, stats) => {
        expect(err).toBeNull();
        linkTime = stats.mtime.getTime();
        resolve();
      });
    });

    await new Promise(resolve => {
      fs.stat(linkPath, (err, stats) => {
        expect(err).toBeNull();
        fileTime = stats.mtime.getTime();
        resolve();
      });
    });

    await new Promise(resolve => {
      fs.readlink(linkPath, (err, destination) => {
        expect(err).toBeNull();
        expect(destination).toBe(linkData);
        resolve();
      });
    });
  });

  test("Test invalid symlink", async () => {
    const linkData = path.resolve(__dirname, "../fixtures/not/exists/file");
    const linkPath = path.resolve(tmpdir, "symlink2.js");

    await new Promise(resolve => {
      fs.symlink(linkData, linkPath, resolve);
    });

    expect(fs.existsSync(linkPath)).toBe(false);
  });

  test("Test invalid inputs", () => {
    const invalidInputs = [false, 1, {}, [], null, undefined];
    const errObj = expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.stringMatching(/target|path/),
    });

    invalidInputs.forEach(input => {
      expect(() => fs.symlink(input, "", () => {})).toThrow(errObj);
      expect(() => fs.symlinkSync(input, "")).toThrow(errObj);

      expect(() => fs.symlink("", input, () => {})).toThrow(errObj);
      expect(() => fs.symlinkSync("", input)).toThrow(errObj);
    });
  });

  test("Test invalid type inputs", () => {
    const errObj = expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      name: "TypeError",
    });

    expect(() => fs.symlink("", "", "🍏", () => {})).toThrow(errObj);
    expect(() => fs.symlinkSync("", "", "🍏")).toThrow(errObj);

    expect(() => fs.symlink("", "", "nonExistentType", () => {})).toThrow(errObj);
    expect(() => fs.symlinkSync("", "", "nonExistentType")).toThrow(errObj);
    expect(fs.promises.symlink("", "", "nonExistentType")).rejects.toMatchObject(errObj);

    expect(() => fs.symlink("", "", false, () => {})).toThrow(errObj);
    expect(() => fs.symlinkSync("", "", false)).toThrow(errObj);
    expect(fs.promises.symlink("", "", false)).rejects.toMatchObject(errObj);

    expect(() => fs.symlink("", "", {}, () => {})).toThrow(errObj);
    expect(() => fs.symlinkSync("", "", {})).toThrow(errObj);
    expect(fs.promises.symlink("", "", {})).rejects.toMatchObject(errObj);
  });

  test("Link time should not be equal to file time", () => {
    expect(linkTime).not.toBe(fileTime);
  });
}

//<#END_FILE: test-fs-symlink.js
