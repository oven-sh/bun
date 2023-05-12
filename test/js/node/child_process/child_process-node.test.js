import { ChildProcess, spawn, exec } from "node:child_process";
import { createTest } from "node-harness";
import { tmpdir } from "node:os";
const { beforeAll, describe, expect, it, throws, assert, createCallCheckCtx, createDoneDotAll } = createTest(
  import.meta.path,
);
const strictEqual = (a, b) => expect(a).toStrictEqual(b);
const debug = process.env.DEBUG ? console.log : () => {};

const platformTmpDir = require("fs").realpathSync(tmpdir());

const TYPE_ERR_NAME = "TypeError";

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

const common = {
  pwdCommand: ["pwd", []],
};

describe("ChildProcess.constructor", () => {
  it("should be a function", () => {
    strictEqual(typeof ChildProcess, "function");
  });
});

describe("ChildProcess.spawn()", () => {
  it("should throw on invalid options", () => {
    // Verify that invalid options to spawn() throw.
    const child = new ChildProcess();

    [undefined, null, "foo", 0, 1, NaN, true, false].forEach(options => {
      throws(
        () => {
          child.spawn(options);
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: TYPE_ERR_NAME,
          // message:
          //   'The "options" argument must be of type object.' +
          //   `${common.invalidArgTypeHelper(options)}`,
        },
      );
    });
  });

  it("should throw if file is not a string", () => {
    // Verify that spawn throws if file is not a string.
    const child = new ChildProcess();
    [undefined, null, 0, 1, NaN, true, false, {}].forEach(file => {
      throws(
        () => {
          child.spawn({ file });
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: TYPE_ERR_NAME,
          // message:
          //   'The "options.file" property must be of type string.' +
          //   `${common.invalidArgTypeHelper(file)}`,
        },
      );
    });
  });

  it("should throw if envPairs is not an array or undefined", () => {
    // Verify that spawn throws if envPairs is not an array or undefined.
    const child = new ChildProcess();

    [null, 0, 1, NaN, true, false, {}, "foo"].forEach(envPairs => {
      throws(
        () => {
          child.spawn({
            envPairs,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          });
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: TYPE_ERR_NAME,
          // message:
          //   'The "options.envPairs" property must be an instance of Array.' +
          //   common.invalidArgTypeHelper(envPairs),
        },
      );
    });
  });

  it("should throw if stdio is not an array or undefined", () => {
    // Verify that spawn throws if args is not an array or undefined.
    const child = new ChildProcess();

    [null, 0, 1, NaN, true, false, {}, "foo"].forEach(args => {
      throws(
        () => {
          child.spawn({ file: "foo", args });
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: TYPE_ERR_NAME,
          // message:
          //   'The "options.args" property must be an instance of Array.' +
          //   common.invalidArgTypeHelper(args),
        },
      );
    });
  });
});

describe("ChildProcess.spawn", () => {
  function getChild() {
    const child = new ChildProcess();
    child.spawn({
      file: "node",
      // file: process.execPath,
      args: ["node", "--interactive"],
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "ignore"],
    });
    return child;
  }

  it("should spawn a process", () => {
    const child = getChild();
    // Test that we can call spawn

    strictEqual(Object.hasOwn(child, "pid"), true);
    assert(Number.isInteger(child.pid));
    child.kill();
  });

  it("should throw error on invalid signal", () => {
    const child = getChild();
    // Try killing with invalid signal
    throws(
      () => {
        child.kill("foo");
      },
      { code: "ERR_UNKNOWN_SIGNAL", name: TYPE_ERR_NAME },
    );
  });
});

describe("ChildProcess spawn bad stdio", () => {
  // Monkey patch spawn() to create a child process normally, but destroy the
  // stdout and stderr streams. This replicates the conditions where the streams
  // cannot be properly created.
  function createChild(options, callback, done, target) {
    var __originalSpawn = ChildProcess.prototype.spawn;
    ChildProcess.prototype.spawn = function () {
      const err = __originalSpawn.apply(this, arguments);

      this.stdout.destroy();
      this.stderr.destroy();

      return err;
    };

    const { mustCall } = createCallCheckCtx(done);
    let cmd = `bun ${import.meta.dir}/spawned-child.js`;
    if (target) cmd += " " + target;
    const child = exec(cmd, options, mustCall(callback));
    ChildProcess.prototype.spawn = __originalSpawn;
    return child;
  }

  it("should handle normal execution of child process", done => {
    createChild(
      {},
      (err, stdout, stderr) => {
        strictEqual(err, null);
        strictEqual(stdout, "");
        strictEqual(stderr, "");
      },
      done,
    );
  });

  it("should handle error event of child process", done => {
    const error = new Error(`Command failed: bun ${import.meta.dir}/spawned-child.js ERROR`);
    createChild(
      {},
      (err, stdout, stderr) => {
        strictEqual(err.message, error.message);
        strictEqual(stdout, "");
        strictEqual(stderr, "");
      },
      done,
      "ERROR",
    );
  });

  it("should handle killed process", done => {
    createChild(
      { timeout: 1 },
      (err, stdout, stderr) => {
        strictEqual(err.killed, true);
        strictEqual(stdout, "");
        strictEqual(stderr, "");
      },
      done,
    );
  });
});

describe("child_process cwd", () => {
  // Spawns 'pwd' with given options, then test
  // - whether the child pid is undefined or number,
  // - whether the exit code equals expectCode,
  // - optionally whether the trimmed stdout result matches expectData
  function testCwd(options, { expectPidType, expectCode = 0, expectData }, done = () => {}) {
    const createDone = createDoneDotAll(done);
    const { mustCall } = createCallCheckCtx(createDone(1500));
    const exitDone = createDone(5000);

    const child = spawn(...common.pwdCommand, options);

    strictEqual(typeof child.pid, expectPidType);

    child.stdout.setEncoding("utf8");

    // No need to assert callback since `data` is asserted.
    let data = "";
    child.stdout.on("data", chunk => {
      data += chunk;
    });

    // TODO: Test exit events
    // // Can't assert callback, as stayed in to API:
    // // _The 'exit' event may or may not fire after an error has occurred._
    child.on("exit", (code, signal) => {
      try {
        strictEqual(code, expectCode);
        exitDone();
      } catch (err) {
        exitDone(err);
      }
    });

    child.on(
      "close",
      mustCall(() => {
        expectData && strictEqual(data.trim(), expectData);
      }),
    );

    return child;
  }

  // TODO: Make sure this isn't important
  // Currently Bun.spawn will still spawn even though cwd doesn't exist
  // // Assume does-not-exist doesn't exist, expect exitCode=-1 and errno=ENOENT
  // it("should throw an error when given cwd doesn't exist", () => {
  //   testCwd({ cwd: "does-not-exist" }, "undefined", -1).on(
  //     "error",
  //     mustCall(function (e) {
  //       console.log(e);
  //       strictEqual(e.code, "ENOENT");
  //     })
  //   );
  // });

  // TODO: Make sure this isn't an important test
  // it("should throw when cwd is a non-file url", () => {
  //   throws(() => {
  //     testCwd(
  //       {
  //         cwd: new URL("http://example.com/"),
  //       },
  //       "number",
  //       0,
  //       tmpdir.path
  //     );
  //   }, /The URL must be of scheme file/);

  //   // if (process.platform !== "win32") {
  //   //   throws(() => {
  //   //     testCwd(
  //   //       {
  //   //         cwd: new URL("file://host/dev/null"),
  //   //       },
  //   //       "number",
  //   //       0,
  //   //       tmpdir.path
  //   //     );
  //   //   }, /File URL host must be "localhost" or empty on/);
  //   // }
  // });

  it("should work for valid given cwd", done => {
    const tmpdir = { path: platformTmpDir };
    const createDone = createDoneDotAll(done);

    // Assume these exist, and 'pwd' gives us the right directory back
    testCwd(
      { cwd: tmpdir.path },
      {
        expectPidType: "number",
        expectCode: 0,
        expectData: platformTmpDir,
      },
      createDone(1500),
    );
    const shouldExistDir = "/dev";
    testCwd(
      { cwd: shouldExistDir },
      {
        expectPidType: "number",
        expectCode: 0,
        expectData: shouldExistDir,
      },
      createDone(1500),
    );
    testCwd(
      { cwd: Bun.pathToFileURL(tmpdir.path) },
      {
        expectPidType: "number",
        expectCode: 0,
        expectData: platformTmpDir,
      },
      createDone(1500),
    );
  });

  it("shouldn't try to chdir to an invalid cwd", done => {
    const createDone = createDoneDotAll(done);
    // Spawn() shouldn't try to chdir() to invalid arg, so this should just work
    testCwd({ cwd: "" }, { expectPidType: "number" }, createDone(1500));
    testCwd({ cwd: undefined }, { expectPidType: "number" }, createDone(1500));
    testCwd({ cwd: null }, { expectPidType: "number" }, createDone(1500));
  });
});

describe("child_process default options", () => {
  it("should use process.env as default env", done => {
    globalThis.process.env.TMPDIR = platformTmpDir;

    let child = spawn("printenv", [], {});
    let response = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      debug(`stdout: ${chunk}`);
      response += chunk;
    });

    // NOTE: Original test used child.on("exit"), but this is unreliable
    // because the process can exit before the stream is closed and the data is read
    child.stdout.on("close", () => {
      expect(response.includes(`TMPDIR=${platformTmpDir}`)).toBe(true);
      done();
    });
  });
});

describe("child_process double pipe", () => {
  it("should allow two pipes to be used at once", done => {
    // const { mustCallAtLeast, mustCall } = createCallCheckCtx(done);
    const mustCallAtLeast = fn => fn;
    const mustCall = fn => fn;
    let grep, sed, echo;
    grep = spawn("grep", ["o"], { stdio: ["pipe", "pipe", "pipe"] });
    sed = spawn("sed", ["s/o/O/"]);
    echo = spawn("echo", ["hello\nnode\nand\nworld\n"]);

    // pipe grep | sed
    grep.stdout.on(
      "data",
      mustCallAtLeast(data => {
        debug(`grep stdout ${data.length}`);
        if (!sed.stdin.write(data)) {
          grep.stdout.pause();
        }
      }),
    );

    // print sed's output
    sed.stdout.on(
      "data",
      mustCallAtLeast(data => {
        result += data.toString("utf8");
        debug(data);
      }),
    );

    echo.stdout.on(
      "data",
      mustCallAtLeast(data => {
        debug(`grep stdin write ${data.length}`);
        if (!grep.stdin.write(data)) {
          debug("echo stdout pause");
          echo.stdout.pause();
        }
      }),
    );

    // TODO(Derrick): We don't implement the full API for this yet,
    // So stdin has no 'drain' event.
    // TODO(@jasnell): This does not appear to ever be
    // emitted. It's not clear if it is necessary.
    grep.stdin.on("drain", () => {
      debug("echo stdout resume");
      echo.stdout.resume();
    });

    // Propagate end from echo to grep
    echo.stdout.on(
      "end",
      mustCall(() => {
        debug("echo stdout end");
        grep.stdin.end();
      }),
    );

    echo.on(
      "exit",
      mustCall(() => {
        debug("echo exit");
      }),
    );

    grep.on(
      "exit",
      mustCall(() => {
        debug("grep exit");
      }),
    );

    sed.on(
      "exit",
      mustCall(() => {
        debug("sed exit");
      }),
    );

    // TODO(@jasnell): This does not appear to ever be
    // emitted. It's not clear if it is necessary.
    sed.stdin.on("drain", () => {
      grep.stdout.resume();
    });

    // Propagate end from grep to sed
    grep.stdout.on(
      "end",
      mustCall(() => {
        debug("grep stdout end");
        sed.stdin.end();
      }),
    );

    let result = "";

    sed.stdout.on(
      "end",
      mustCall(() => {
        debug("result: " + result);
        strictEqual(result, `hellO\nnOde\nwOrld\n`);
        done();
      }),
    );
  });
});
