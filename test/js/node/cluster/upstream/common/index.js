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

// /* eslint-disable node-core/crypto-check */
"use strict";
const process = global.process; // Some tests tamper with the process global.

const assert = require("assert");
const { exec, execSync, spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
// Do not require 'os' until needed so that test-os-checked-function can
// monkey patch it. If 'os' is required here, that test will fail.
const path = require("path");
const { inspect } = require("util");
const { isMainThread } = require("worker_threads");

// Some tests assume a umask of 0o022 so set that up front. Tests that need a
// different umask will set it themselves.
//
// Workers can read, but not set the umask, so check that this is the main
// thread.
if (isMainThread) process.umask(0o022);

const noop = () => {};

const isWindows = process.platform === "win32";
const isSunOS = process.platform === "sunos";
const isFreeBSD = process.platform === "freebsd";
const isOpenBSD = process.platform === "openbsd";
const isLinux = process.platform === "linux";
const isOSX = process.platform === "darwin";
const isPi = (() => {
  try {
    // Normal Raspberry Pi detection is to find the `Raspberry Pi` string in
    // the contents of `/sys/firmware/devicetree/base/model` but that doesn't
    // work inside a container. Match the chipset model number instead.
    const cpuinfo = fs.readFileSync("/proc/cpuinfo", { encoding: "utf8" });
    const ok = /^Hardware\s*:\s*(.*)$/im.exec(cpuinfo)?.[1] === "BCM2835";
    /^/.test(""); // Clear RegExp.$_, some tests expect it to be empty.
    return ok;
  } catch {
    return false;
  }
})();

const isDumbTerminal = process.env.TERM === "dumb";

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
      context.actual,
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

function _mustCallInner(fn, criteria = 1, field) {
  if (process._exiting) throw new Error("Cannot use common.mustCall*() in process exit handler");
  if (typeof fn === "number") {
    criteria = fn;
    fn = noop;
  } else if (fn === undefined) {
    fn = noop;
  }

  if (typeof criteria !== "number") throw new TypeError(`Invalid ${field} value: ${criteria}`);

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

function getCallSite(top) {
  const originalStackFormatter = Error.prepareStackTrace;
  Error.prepareStackTrace = (err, stack) => `${stack[0].getFileName()}:${stack[0].getLineNumber()}`;
  const err = new Error();
  Error.captureStackTrace(err, top);
  // With the V8 Error API, the stack is not formatted until it is accessed
  err.stack; // eslint-disable-line no-unused-expressions
  Error.prepareStackTrace = originalStackFormatter;
  return err.stack;
}

function mustNotCall(msg) {
  const callSite = getCallSite(mustNotCall);
  return function mustNotCall(...args) {
    const argsInfo = args.length > 0 ? `\ncalled with arguments: ${args.map(arg => inspect(arg)).join(", ")}` : "";
    assert.fail(`${msg || "function should not have been called"} at ${callSite}` + argsInfo);
  };
}

function printSkipMessage(msg) {
  console.log(`1..0 # Skipped: ${msg}`);
}

function skip(msg) {
  printSkipMessage(msg);
  process.exit(0);
}

function isAlive(pid) {
  try {
    process.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

function skipIf32Bits() {
  if (bits < 64) {
    skip("The tested feature is not available in 32bit builds");
  }
}

function skipIfWorker() {
  if (!isMainThread) {
    skip("This test only works on a main thread");
  }
}

function skipIfDumbTerminal() {
  if (isDumbTerminal) {
    skip("skipping - dumb terminal");
  }
}

const common = {
  isAlive,
  isDumbTerminal,
  isFreeBSD,
  isLinux,
  isMainThread,
  isOpenBSD,
  isOSX,
  isPi,
  isSunOS,
  isWindows,
  mustCall,
  mustNotCall,
  mustSucceed,
  printSkipMessage,
  skip,
  skipIf32Bits,
  skipIfDumbTerminal,
  // On IBMi, process.platform and os.platform() both return 'aix',
  // when built with Python versions earlier than 3.9.
  // It is not enough to differentiate between IBMi and real AIX system.
  get isAIX() {
    return require("os").type() === "AIX";
  },

  get isIBMi() {
    return require("os").type() === "OS400";
  },

  get isLinuxPPCBE() {
    return process.platform === "linux" && process.arch === "ppc64" && require("os").endianness() === "BE";
  },
};

const validProperties = new Set(Object.keys(common));
module.exports = new Proxy(common, {
  get(obj, prop) {
    if (!validProperties.has(prop)) throw new Error(`Using invalid common property: '${prop}'`);
    return obj[prop];
  },
});
