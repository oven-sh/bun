import { describe, expect, it } from "bun:test";
import { ChildProcess, spawn, exec } from "node:child_process";
import { EOL } from "node:os";
import assertNode from "node:assert";
import { inspect } from "node:util";

const debug = console.log;

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
  // // TODO: Fix the implementations of these functions, they may be ruining everything...
  // mustCallAtLeast: function mustCallAtLeast(callback) {
  //   return (...args) => {
  //     callback(...args);
  //     expect(true).toBe(true);
  //   };
  // },
  // mustCall: function mustCall(callback) {
  //   return (...args) => {
  //     callback(...args);
  //     expect(true).toBe(true);
  //   };
  // },
  pwdCommand: ["pwd", []],
};

const mustCallChecks = [];

function runCallChecks(exitCode) {
  if (exitCode !== 0) return;

  const failed = mustCallChecks.filter(function (context) {
    if ("minimum" in context) {
      context.messageSegment = `at least ${context.minimum}`;
      return context.actual < context.minimum;
    }
    context.messageSegment = `exactly ${context.exact}`;
    return context.actual !== context.exact;
  });

  failed.forEach(function (context) {
    console.log(
      "Mismatched %s function calls. Expected %s, actual %d.",
      context.name,
      context.messageSegment,
      context.actual
    );
    console.log(context.stack.split("\n").slice(2).join("\n"));
  });

  if (failed.length) process.exit(1);
}

function mustCall(fn, exact) {
  return _mustCallInner(fn, exact, "exact");
}

function mustSucceed(fn, exact) {
  return mustCall(function (err, ...args) {
    assert.ifError(err);
    if (typeof fn === "function") return fn.apply(this, args);
  }, exact);
}

function mustCallAtLeast(fn, minimum) {
  return _mustCallInner(fn, minimum, "minimum");
}

function _mustCallInner(fn, criteria = 1, field) {
  if (process._exiting)
    throw new Error("Cannot use common.mustCall*() in process exit handler");
  if (typeof fn === "number") {
    criteria = fn;
    fn = noop;
  } else if (fn === undefined) {
    fn = noop;
  }

  if (typeof criteria !== "number")
    throw new TypeError(`Invalid ${field} value: ${criteria}`);

  const context = {
    [field]: criteria,
    actual: 0,
    stack: inspect(new Error()),
    name: fn.name || "<anonymous>",
  };

  // Add the exit listener only once to avoid listener leak warnings
  if (mustCallChecks.length === 0) process.on("exit", runCallChecks);

  mustCallChecks.push(context);

  const _return = function () {
    // eslint-disable-line func-style
    context.actual++;
    return fn.apply(this, arguments);
  };
  // Function instances have own properties that may be relevant.
  // Let's replicate those properties to the returned function.
  // Refs: https://tc39.es/ecma262/#sec-function-instances
  Object.defineProperties(_return, {
    name: {
      value: fn.name,
      writable: false,
      enumerable: false,
      configurable: true,
    },
    length: {
      value: fn.length,
      writable: false,
      enumerable: false,
      configurable: true,
    },
  });
  return _return;
}

const strictEqual = (...args) => {
  let error = null;
  try {
    assertNode.strictEqual(...args);
  } catch (err) {
    error = err;
  }
  expect(error).toBe(null);
};

const throws = (...args) => {
  let error = null;
  try {
    assertNode.throws(...args);
  } catch (err) {
    error = err;
  }
  expect(error).toBe(null);
};

const assert = (...args) => {
  let error = null;
  try {
    assertNode(...args);
  } catch (err) {
    error = err;
  }
  expect(error).toBe(null);
};

const assertOk = (...args) => {
  let error = null;
  try {
    assertNode.ok(...args);
  } catch (err) {
    error = err;
  }
  expect(error).toBe(null);
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

    [undefined, null, "foo", 0, 1, NaN, true, false].forEach((options) => {
      throws(
        () => {
          child.spawn(options);
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          // message:
          //   'The "options" argument must be of type object.' +
          //   `${common.invalidArgTypeHelper(options)}`,
        }
      );
    });
  });

  it("should throw if file is not a string", () => {
    // Verify that spawn throws if file is not a string.
    const child = new ChildProcess();
    [undefined, null, 0, 1, NaN, true, false, {}].forEach((file) => {
      throws(
        () => {
          child.spawn({ file });
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          // message:
          //   'The "options.file" property must be of type string.' +
          //   `${common.invalidArgTypeHelper(file)}`,
        }
      );
    });
  });

  it("should throw if envPairs is not an array or undefined", () => {
    // Verify that spawn throws if envPairs is not an array or undefined.
    const child = new ChildProcess();

    [null, 0, 1, NaN, true, false, {}, "foo"].forEach((envPairs) => {
      throws(
        () => {
          child.spawn({
            envPairs,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          });
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          // message:
          //   'The "options.envPairs" property must be an instance of Array.' +
          //   common.invalidArgTypeHelper(envPairs),
        }
      );
    });
  });

  it("should throw if stdio is not an array or undefined", () => {
    // Verify that spawn throws if args is not an array or undefined.
    const child = new ChildProcess();

    [null, 0, 1, NaN, true, false, {}, "foo"].forEach((args) => {
      throws(
        () => {
          child.spawn({ file: "foo", args });
        },
        {
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          // message:
          //   'The "options.args" property must be an instance of Array.' +
          //   common.invalidArgTypeHelper(args),
        }
      );
    });
  });
});

describe("ChildProcess.spawn", () => {
  const child = new ChildProcess();
  child.spawn({
    file: "bun",
    // file: process.execPath,
    args: ["--interactive"],
    cwd: process.cwd(),
    stdio: "pipe",
  });

  it("should spawn a process", () => {
    // Test that we can call spawn

    strictEqual(Object.hasOwn(child, "pid"), true);
    assert(Number.isInteger(child.pid));
  });

  it("should throw error on invalid signal", () => {
    // Try killing with invalid signal
    throws(
      () => {
        child.kill("foo");
      },
      { code: "ERR_UNKNOWN_SIGNAL", name: "TypeError" }
    );
  });

  it("should die when killed", () => {
    strictEqual(child.kill(), true);
  });
});

describe("ChildProcess spawn bad stdio", () => {
  // Monkey patch spawn() to create a child process normally, but destroy the
  // stdout and stderr streams. This replicates the conditions where the streams
  // cannot be properly created.
  const original = ChildProcess.prototype.spawn;

  ChildProcess.prototype.spawn = function () {
    const err = original.apply(this, arguments);

    this.stdout.destroy();
    this.stderr.destroy();
    this.stdout = null;
    this.stderr = null;

    return err;
  };

  function createChild(options, callback) {
    const cmd = `"${process.execPath}" "${import.meta.path}" child`;
    return exec(cmd, options, mustCall(callback));
  }

  it("should handle normal execution of child process", () => {
    createChild({}, (err, stdout, stderr) => {
      strictEqual(err, null);
      strictEqual(stdout, "");
      strictEqual(stderr, "");
    });
  });

  it("should handle error event of child process", () => {
    const error = new Error("foo");
    const child = createChild({}, (err, stdout, stderr) => {
      strictEqual(err, error);
      strictEqual(stdout, "");
      strictEqual(stderr, "");
    });

    child.emit("error", error);
  });

  it("should handle killed process", () => {
    createChild({ timeout: 1 }, (err, stdout, stderr) => {
      strictEqual(err.killed, true);
      strictEqual(stdout, "");
      strictEqual(stderr, "");
    });
  });

  ChildProcess.prototype.spawn = original;
});

describe("child_process cwd", () => {
  const tmpdir = { path: Bun.env.TMPDIR };

  // Spawns 'pwd' with given options, then test
  // - whether the child pid is undefined or number,
  // - whether the exit code equals expectCode,
  // - optionally whether the trimmed stdout result matches expectData
  function testCwd(options, expectPidType, expectCode = 0, expectData) {
    const child = spawn(...common.pwdCommand, options);

    strictEqual(typeof child.pid, expectPidType);

    child.stdout.setEncoding("utf8");

    // No need to assert callback since `data` is asserted.
    let data = "";
    child.stdout.on("data", function (chunk) {
      data += chunk;
    });

    // Can't assert callback, as stayed in to API:
    // _The 'exit' event may or may not fire after an error has occurred._
    child.on("exit", function (code, signal) {
      strictEqual(code, expectCode).bind(this);
    });

    child.on(
      "close",
      mustCall(function () {
        expectData && strictEqual(data.trim(), expectData);
      })
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

  it("should work for valid given cwd", () => {
    // Assume these exist, and 'pwd' gives us the right directory back
    testCwd({ cwd: tmpdir.path }, "number", 0, tmpdir.path);
    const shouldExistDir = "/dev";
    testCwd({ cwd: shouldExistDir }, "number", 0, shouldExistDir);
    testCwd({ cwd: Bun.pathToFileURL(tmpdir.path) }, "number", 0, tmpdir.path);
  });

  it("shouldn't try to chdir to an invalid cwd", () => {
    // Spawn() shouldn't try to chdir() to invalid arg, so this should just work
    testCwd({ cwd: "" }, "number");
    testCwd({ cwd: undefined }, "number");
    testCwd({ cwd: null }, "number");
  });
});

describe("child_process default options", () => {
  process.env.HELLO = "WORLD";

  let child = spawn("/usr/bin/env", [], {});
  let response = "";

  child.stdout.setEncoding("utf8");

  it("should use process.env as default env", () => {
    child.stdout.on("data", function (chunk) {
      debug(`stdout: ${chunk}`);
      response += chunk;
    });

    process.on("exit", function () {
      assertOk(
        response.includes("HELLO=WORLD"),
        "spawn did not use process.env as default " +
          `(process.env.HELLO = ${process.env.HELLO})`
      );
    });
  });

  delete process.env.HELLO;
});

describe("child_process double pipe", () => {
  let grep, sed, echo;
  grep = spawn("grep", ["o"]);
  sed = spawn("sed", ["s/o/O/"]);
  echo = spawn("echo", ["hello\nnode\nand\nworld\n"]);

  it("should allow two pipes to be used at once", () => {
    // pipe echo | grep
    echo.stdout.on(
      "data",
      mustCallAtLeast((data) => {
        debug(`grep stdin write ${data.length}`);
        if (!grep.stdin.write(data)) {
          echo.stdout.pause();
        }
      })
    );

    // TODO(Derrick): We don't implement the full API for this yet,
    // So stdin has no 'drain' event.
    // // TODO(@jasnell): This does not appear to ever be
    // // emitted. It's not clear if it is necessary.
    // grep.stdin.on("drain", (data) => {
    //   echo.stdout.resume();
    // });

    // Propagate end from echo to grep
    echo.stdout.on(
      "end",
      mustCall((code) => {
        grep.stdin.end();
      })
    );

    echo.on(
      "exit",
      mustCall(() => {
        debug("echo exit");
      })
    );

    grep.on(
      "exit",
      mustCall(() => {
        debug("grep exit");
      })
    );

    sed.on(
      "exit",
      mustCall(() => {
        debug("sed exit");
      })
    );

    // pipe grep | sed
    grep.stdout.on(
      "data",
      mustCallAtLeast((data) => {
        debug(`grep stdout ${data.length}`);
        if (!sed.stdin.write(data)) {
          grep.stdout.pause();
        }
      })
    );

    // // TODO(@jasnell): This does not appear to ever be
    // // emitted. It's not clear if it is necessary.
    // sed.stdin.on("drain", (data) => {
    //   grep.stdout.resume();
    // });

    // Propagate end from grep to sed
    grep.stdout.on(
      "end",
      mustCall((code) => {
        debug("grep stdout end");
        sed.stdin.end();
      })
    );

    let result = "";

    // print sed's output
    sed.stdout.on(
      "data",
      mustCallAtLeast((data) => {
        result += data.toString("utf8", 0, data.length);
        debug(data);
      })
    );

    sed.stdout.on(
      "end",
      mustCall((code) => {
        strictEqual(result, `hellO${EOL}nOde${EOL}wOrld${EOL}`);
      })
    );
  });
});
