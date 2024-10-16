//#FILE: test-process-uid-gid.js
//#SHA1: fdd637ef2fcf3bcada2c86f574494e32e5c03780
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

const isWindows = process.platform === "win32";
const isMainThread = !process.env.NODE_WORKER_ID;

if (isWindows) {
  test("uid/gid functions are POSIX only", () => {
    // uid/gid functions are POSIX only.
    expect(process.getuid).toBeUndefined();
    expect(process.getgid).toBeUndefined();
    expect(process.setuid).toBeUndefined();
    expect(process.setgid).toBeUndefined();
  });
} else if (isMainThread) {
  test("setuid with invalid arguments", () => {
    expect(() => process.setuid({})).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "id" argument must be of type number or string'),
      }),
    );

    expect(() => process.setuid("fhqwhgadshgnsdhjsdbkhsdabkfabkveyb")).toThrow(
      expect.objectContaining({
        code: "ERR_UNKNOWN_CREDENTIAL",
        message: "User identifier does not exist: fhqwhgadshgnsdhjsdbkhsdabkfabkveyb",
      }),
    );
  });

  test("edge cases for uid/gid functions", () => {
    // Passing -0 shouldn't crash the process
    // Refs: https://github.com/nodejs/node/issues/32750
    // And neither should values exceeding 2 ** 31 - 1.
    const ids = [-0, 2 ** 31, 2 ** 32 - 1];
    const fns = [process.setuid, process.setuid, process.setgid, process.setegid];

    for (const id of ids) {
      for (const fn of fns) {
        expect(() => {
          try {
            fn(id);
          } catch {
            // Continue regardless of error.
          }
        }).not.toThrow();
      }
    }
  });

  if (process.getuid() !== 0) {
    test("non-root user permissions", () => {
      // Should not throw.
      expect(() => process.getgid()).not.toThrow();
      expect(() => process.getuid()).not.toThrow();

      expect(() => process.setgid("nobody")).toThrow(
        expect.objectContaining({
          syscall: "setgid",
          code: "EPERM",
        }),
      );

      expect(() => process.setuid("nobody")).toThrow(
        expect.objectContaining({
          syscall: "setuid",
          code: "EPERM",
        }),
      );
    });
  } else {
    test("root user permissions", async () => {
      const oldgid = process.getgid();
      try {
        process.setgid("nobody");
      } catch (err) {
        if (err.code !== "ERR_UNKNOWN_CREDENTIAL") {
          throw err;
        }
        process.setgid("nogroup");
      }

      const newgid = process.getgid();
      expect(newgid).not.toBe(oldgid);

      const olduid = process.getuid();
      process.setuid("nobody");
      const newuid = process.getuid();
      expect(newuid).not.toBe(olduid);
    });
  }
}

//<#END_FILE: test-process-uid-gid.js
