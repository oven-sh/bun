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

const assert = require("assert");
const { inspect } = require("util");

const noop = () => {};

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";
const isOSX = process.platform === "darwin";

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

const common = {
  isAlive,
  isLinux,
  isOSX,
  isWindows,
  mustCall,
  mustNotCall,
  mustSucceed,
  printSkipMessage,
  skip,
};

const validProperties = new Set(Object.keys(common));
module.exports = new Proxy(common, {
  get(obj, prop) {
    if (!validProperties.has(prop)) throw new Error(`Using invalid common property: '${prop}'`);
    return obj[prop];
  },
});
