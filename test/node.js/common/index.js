// https://github.com/nodejs/node/blob/c975384264dc553de62398be814d0c66fc1fc1fb/test/common/index.js

import { inspect } from "bun";
import { expect, afterAll } from "bun:test";

const hasIntl = true;
const hasCrypto = true;
const hasOpenSSL3 = false;
const hasOpenSSL31 = false;
const hasQuic = false;

const { platform, env } = process;
const isWindows = platform === "win32";
const isSunOS = platform === "sunos";
const isFreeBSD = platform === "freebsd";
const isOpenBSD = platform === "openbsd";
const isLinux = platform === "linux";
const isOSX = platform === "darwin";
const isAsan = false;
const isPi = false;
const isDumbTerminal = env.TERM === "dumb";

function mustCall(fn, n = 1) {
  const callSite = getCallSite(mustCall);

  let calls = 0;
  const mustCallFn = function (...args) {
    calls++;
    return fn.apply(this, args);
  };

  afterAll(() => {
    if (calls !== n) {
      throw new Error(`function should be called exactly ${n} times:\n ${callSite}`);
    }
  });

  return mustCallFn;
}

function mustNotCall() {
  const callSite = getCallSite(mustNotCall);

  return function mustNotCall(...args) {
    const argsInfo = args.length > 0 ? `\ncalled with arguments: ${args.map(arg => inspect(arg)).join(", ")}` : "";
    assert.fail(`${msg || "function should not have been called"} at ${callSite}` + argsInfo);
  };
}

function printSkipMessage(message) {
  console.warn(message);
}

function skip(message) {
  printSkipMessage(message);
  process.exit(0);
}

function expectsError(validator, exact) {
  return mustCall((...args) => {
    if (args.length !== 1) {
      // Do not use `assert.strictEqual()` to prevent `inspect` from
      // always being called.
      assert.fail(`Expected one argument, got ${inspect(args)}`);
    }
    const error = args.pop();
    // The error message should be non-enumerable
    assert.strictEqual(Object.prototype.propertyIsEnumerable.call(error, "message"), false);

    assert.throws(() => {
      throw error;
    }, validator);
    return true;
  }, exact);
}

function expectWarning(name, code, message) {
  // Do nothing
}

function invalidArgTypeHelper(input) {
  return ` Received: ${inspect(input)}`;
}

function getCallSite(fn) {
  const originalStackFormatter = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => `${stack[0].getFileName()}:${stack[0].getLineNumber()}`;
  const error = new Error();
  Error.captureStackTrace(error, fn);
  error.stack; // With the V8 Error API, the stack is not formatted until it is accessed
  Error.prepareStackTrace = originalStackFormatter;
  return error.stack;
}

export {
  hasIntl,
  hasCrypto,
  hasOpenSSL3,
  hasOpenSSL31,
  hasQuic,
  // ...
  isWindows,
  isSunOS,
  isFreeBSD,
  isOpenBSD,
  isLinux,
  isOSX,
  isAsan,
  isPi,
  // ...
  isDumbTerminal,
  // ...
  mustCall,
  mustNotCall,
  printSkipMessage,
  skip,
  expectsError,
  expectWarning,
  // ...
  inspect,
  invalidArgTypeHelper,
};
