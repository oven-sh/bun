import { ChildProcess, spawn, exec, fork } from "node:child_process";
import { createTest } from "node-harness";
import { tmpdir } from "node:os";
import path from "node:path";
import util from "node:util";
import { bunEnv, bunExe, isWindows } from "harness";
const { beforeAll, beforeEach, afterAll, describe, expect, it, throws, assert, createCallCheckCtx, createDoneDotAll } =
  createTest(import.meta.path);
const origProcessEnv = process.env;
beforeEach(() => {
  process.env = { ...bunEnv };
});
afterAll(() => {
  process.env = origProcessEnv;
});
const strictEqual = (a, b) => expect(a).toStrictEqual(b);
const debug = process.env.DEBUG ? console.log : () => {};

const platformTmpDir = require("fs").realpathSync(tmpdir());

const TYPE_ERR_NAME = "TypeError";

const fixturesDir = path.join(__dirname, "fixtures");

const fixtures = {
  path(...args) {
    const strings = [fixturesDir, ...args].filter(util.isString);
    return path.join(...strings);
  },
};

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
  pwdCommand: isWindows ? ["node", ["-e", "process.stdout.write(process.cwd() + '\\n')"]] : ["pwd", []],
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
  function createChild(options, callback, target) {
    return new Promise((resolve, reject) => {
      var __originalSpawn = ChildProcess.prototype.spawn;
      ChildProcess.prototype.spawn = function () {
        const err = __originalSpawn.apply(this, arguments);
        this.stdout.destroy();
        this.stderr.destroy();

        return err;
      };

      let cmd =
        target === "sleep"
          ? // The process can exit before returning which breaks tests.
            ((target = ""), `${bunExe()} -e "setTimeout(() => {}, 100)"`)
          : `${bunExe()} ${path.join(import.meta.dir, "spawned-child.js")}`;
      if (target) cmd += " " + target;
      const child = exec(cmd, options, async (err, stdout, stderr) => {
        try {
          await callback(err, stdout, stderr);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      ChildProcess.prototype.spawn = __originalSpawn;
    });
  }

  it("should handle normal execution of child process", async () => {
    await createChild({}, (err, stdout, stderr) => {
      strictEqual(err, null);
      strictEqual(stdout, "");
      strictEqual(stderr, "");
    });
  });

  it.todo("should handle error event of child process", async () => {
    const error = new Error(`Command failed: bun ${import.meta.dir}/spawned-child.js ERROR`);
    await createChild(
      {},
      (err, stdout, stderr) => {
        strictEqual(stdout, "");
        strictEqual(stderr, "");
        strictEqual(err?.message, error.message);
      },
      "ERROR",
    );
  });

  it("should handle killed process", async () => {
    await createChild(
      { timeout: 1 },
      (err, stdout, stderr) => {
        strictEqual(err.killed, true);
        strictEqual(stdout, "");
        strictEqual(stderr, "");
      },
      "sleep",
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

    const child = spawn(...common.pwdCommand, { stdio: ["inherit", "pipe", "inherit"], ...options });

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

    child.stdout.on(
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
  //     }),
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
    const shouldExistDir = isWindows ? "C:\\Windows\\System32" : "/dev";
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
    process.env.TMPDIR = platformTmpDir;

    // fake printenv
    let child = spawn(bunExe(), ["--print", "process.env"], {});
    let response = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      debug(`stdout: ${chunk}`);
      response += chunk;
    });

    // NOTE: Original test used child.on("exit"), but this is unreliable
    // because the process can exit before the stream is closed and the data is read
    child.stdout.on("close", () => {
      try {
        expect(response).toContain(`TMPDIR: "${platformTmpDir.replace(/\\/g, "\\\\")}"`);
        done();
      } catch (e) {
        done(e);
      }
    });
  });
});

describe("child_process double pipe", () => {
  it("should allow two pipes to be used at once", done => {
    // const { mustCallAtLeast, mustCall } = createCallCheckCtx(done);
    const mustCallAtLeast = fn => fn;
    const mustCall = fn => fn;
    let fakeGrep, fakeSed, fakeEcho;
    fakeGrep = spawn(bunExe(), [
      "-e",
      "process.stdin.on('data', (data) => { const dataStr = data.toString(); if (dataStr.includes('o')) process.stdout.write(dataStr); });",
    ]);
    fakeSed = spawn(bunExe(), [
      "-e",
      "process.stdin.on('data', (data) => { process.stdout.write(data.toString().replace(/o/g, 'O')); });",
    ]);
    fakeEcho = spawn(bunExe(), ["-e", "console.log('hello');console.log('node');console.log('world');"]);

    // pipe grep | sed
    fakeGrep.stdout.on(
      "data",
      mustCallAtLeast(data => {
        debug(`grep stdout ${data.length}`);
        if (!fakeSed.stdin.write(data)) {
          fakeGrep.stdout.pause();
        }
      }),
    );

    // print sed's output
    fakeSed.stdout.on(
      "data",
      mustCallAtLeast(data => {
        result += data.toString("utf8");
        debug(data);
      }),
    );

    fakeEcho.stdout.on(
      "data",
      mustCallAtLeast(data => {
        debug(`grep stdin write ${data.length}`);
        if (!fakeGrep.stdin.write(data)) {
          debug("echo stdout pause");
          fakeEcho.stdout.pause();
        }
      }),
    );

    // TODO(Derrick): We don't implement the full API for this yet,
    // So stdin has no 'drain' event.
    // TODO(@jasnell): This does not appear to ever be
    // emitted. It's not clear if it is necessary.
    fakeGrep.stdin.on("drain", () => {
      debug("echo stdout resume");
      fakeEcho.stdout.resume();
    });

    // Propagate end from echo to grep
    fakeEcho.stdout.on(
      "end",
      mustCall(() => {
        debug("echo stdout end");
        fakeGrep.stdin.end();
      }),
    );

    fakeEcho.on(
      "exit",
      mustCall(() => {
        debug("echo exit");
      }),
    );

    fakeGrep.on(
      "exit",
      mustCall(() => {
        debug("grep exit");
      }),
    );

    fakeSed.on(
      "exit",
      mustCall(() => {
        debug("sed exit");
      }),
    );

    // TODO(@jasnell): This does not appear to ever be
    // emitted. It's not clear if it is necessary.
    fakeSed.stdin.on("drain", () => {
      fakeGrep.stdout.resume();
    });

    // Propagate end from grep to sed
    fakeGrep.stdout.on(
      "end",
      mustCall(() => {
        debug("grep stdout end");
        fakeSed.stdin.end();
      }),
    );

    let result = "";

    fakeSed.stdout.on(
      "end",
      mustCall(() => {
        debug("result: " + result);
        strictEqual(result, `hellO\nnOde\nwOrld\n`);
        done();
      }),
    );
  });
});

describe("fork", () => {
  const expectedEnv = { foo: "bar" };
  describe("abort-signal", () => {
    it("Test aborting a forked child_process after calling fork", done => {
      const { mustCall } = createCallCheckCtx(done);
      const ac = new AbortController();
      const { signal } = ac;
      const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
        signal,
        env: bunEnv,
      });
      cp.on(
        "exit",
        mustCall((code, killSignal) => {
          strictEqual(code, null);
          strictEqual(killSignal, "SIGTERM");
        }),
      );
      cp.on(
        "error",
        mustCall(err => {
          strictEqual(err.name, "AbortError");
        }),
      );
      process.nextTick(() => ac.abort());
    });
    it("Test aborting with custom error", done => {
      const { mustCall } = createCallCheckCtx(done);
      const ac = new AbortController();
      const { signal } = ac;
      const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
        signal,
        env: bunEnv,
      });
      cp.on(
        "exit",
        mustCall((code, killSignal) => {
          strictEqual(code, null);
          strictEqual(killSignal, "SIGTERM");
        }),
      );
      cp.on(
        "error",
        mustCall(err => {
          strictEqual(err.name, "AbortError");
          strictEqual(err.cause.name, "Error");
          strictEqual(err.cause.message, "boom");
        }),
      );
      process.nextTick(() => ac.abort(new Error("boom")));
    });
    it("Test passing an already aborted signal to a forked child_process", done => {
      const { mustCall } = createCallCheckCtx(done);
      const signal = AbortSignal.abort();
      const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
        signal,
        env: bunEnv,
      });
      cp.on(
        "exit",
        mustCall((code, killSignal) => {
          strictEqual(code, null);
          strictEqual(killSignal, "SIGTERM");
        }),
      );
      cp.on(
        "error",
        mustCall(err => {
          strictEqual(err.name, "AbortError");
        }),
      );
    });
    it("Test passing an aborted signal with custom error to a forked child_process", done => {
      const { mustCall } = createCallCheckCtx(done);
      const signal = AbortSignal.abort(new Error("boom"));
      const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
        signal,
      });
      cp.on(
        "exit",
        mustCall((code, killSignal) => {
          strictEqual(code, null);
          strictEqual(killSignal, "SIGTERM");
        }),
      );
      cp.on(
        "error",
        mustCall(err => {
          strictEqual(err.name, "AbortError");
          strictEqual(err.cause.name, "Error");
          strictEqual(err.cause.message, "boom");
        }),
      );
    });
    it("Test passing a different kill signal", done => {
      const { mustCall } = createCallCheckCtx(done);
      const signal = AbortSignal.abort();
      const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
        signal,
        killSignal: "SIGKILL",
        env: bunEnv,
      });
      cp.on(
        "exit",
        mustCall((code, killSignal) => {
          strictEqual(code, null);
          strictEqual(killSignal, "SIGKILL");
        }),
      );
      cp.on(
        "error",
        mustCall(err => {
          strictEqual(err.name, "AbortError");
        }),
      );
    });
    // This event doesn't run
    it.todo("Test aborting a cp before close but after exit", done => {
      const { mustCall, mustNotCall } = createCallCheckCtx(done);
      const ac = new AbortController();
      const { signal } = ac;
      const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
        signal,
        env: bunEnv,
      });
      cp.on(
        "exit",
        mustCall(() => {
          ac.abort();
        }),
      );
      cp.on("error", mustNotCall());

      setTimeout(() => cp.kill(), 1);
    });
  });
  describe("args", () => {
    it("Ensure that first argument `modulePath` must be provided and be of type string", () => {
      const invalidModulePath = [0, true, undefined, null, [], {}, () => {}, Symbol("t")];
      invalidModulePath.forEach(modulePath => {
        expect(() => fork(modulePath, { env: bunEnv })).toThrow({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: `The "modulePath" argument must be of type string,Buffer,URL. Received ${modulePath?.toString()}`,
        });
      });
    });
    // This test fails due to a DataCloneError or due to "Unable to deserialize data."
    // This test was originally marked as TODO before the process changes.
    it.todo(
      "Ensure that the second argument of `fork` and `fork` should parse options correctly if args is undefined or null",
      done => {
        const invalidSecondArgs = [0, true, () => {}, Symbol("t")];
        try {
          invalidSecondArgs.forEach(arg => {
            expect(() => fork(fixtures.path("child-process-echo-options.js"), arg)).toThrow({
              code: "ERR_INVALID_ARG_TYPE",
              name: "TypeError",
              message: `The \"args\" argument must be of type Array. Received ${arg?.toString()}`,
            });
          });
        } catch (e) {
          done(e);
          return;
        }

        const argsLists = [[]];

        const { mustCall } = createCallCheckCtx(done);

        argsLists.forEach(args => {
          const cp = fork(fixtures.path("child-process-echo-options.js"), args, {
            env: { ...bunEnv, ...expectedEnv },
          });

          cp.on(
            "message",
            mustCall(({ env }) => {
              assert.strictEqual(env.foo, expectedEnv.foo);
            }),
          );

          cp.on(
            "exit",
            mustCall(code => {
              assert.strictEqual(code, 0);
            }),
          );
        });
      },
    );
    it("Ensure that the third argument should be type of object if provided", () => {
      const invalidThirdArgs = [0, true, () => {}, Symbol("t")];
      invalidThirdArgs.forEach(arg => {
        expect(() => {
          fork(fixtures.path("child-process-echo-options.js"), [], arg);
        }).toThrow({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: `The \"options\" argument must be of type object. Received ${arg?.toString()}`,
        });
      });
    });
  });
  describe.todo("close", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-close.js
  });
  describe.todo("detached", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-detached.js
  });
  describe.todo("dgram", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-dgram.js
  });
  describe.todo("net", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-net.js
  });
  describe.todo("net-server", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-net-server.js
  });
  describe.todo("net-socket", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-net-socket.js
  });
  describe.todo("no-shell", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-no-shell.js
  });
  describe.todo("ref", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-ref.js
  });
  describe.todo("stdio", () => {
    // https://github.com/nodejs/node/blob/v20.5.0/test/parallel/test-child-process-fork-stdio.js
  });
  describe("fork", () => {
    it.todo("message", done => {
      // TODO - bun has no `send` method in the process
      const { mustCall } = createCallCheckCtx(done);
      const args = ["foo", "bar"];
      const n = fork(fixtures.path("child-process-spawn-node.js"), args);
      assert.strictEqual(n.channel, n._channel);
      assert.deepStrictEqual(args, ["foo", "bar"]);
      n.on("message", m => {
        debug("PARENT got message:", m);
        assert.ok(m.foo);
      });
      expect(() => n.send(undefined)).toThrow({
        name: "TypeError",
        message: 'The "message" argument must be specified',
        code: "ERR_MISSING_ARGS",
      });
      expect(() => n.send()).toThrow({
        name: "TypeError",
        message: 'The "message" argument must be specified',
        code: "ERR_MISSING_ARGS",
      });
      expect(() => n.send(Symbol())).toThrow({
        name: "TypeError",
        message:
          'The "message" argument must be one of type string,' +
          " object, number, or boolean. Received type symbol (Symbol())",
        code: "ERR_INVALID_ARG_TYPE",
      });
      n.send({ hello: "world" });
      n.on(
        "exit",
        mustCall(c => {
          assert.strictEqual(c, 0);
        }),
      );
    });
  });
});
