import { expect } from "bun:test";

function deepEqual(actual, expected, message) {
  if (isIgnored(expected, message)) {
    return;
  }
  try {
    expect(actual).toEqual(expected);
  } catch (cause) {
    throwError(cause, message);
  }
}

function deepStrictEqual(actual, expected, message) {
  if (isIgnored(expected, message)) {
    return;
  }
  try {
    expect(actual).toStrictEqual(expected);
  } catch (cause) {
    throwError(cause, message);
  }
}

function doesNotMatch(string, regexp, message) {
  if (isIgnored(regexp, message)) {
    return;
  }
  try {
    expect(string).not.toMatch(regexp);
  } catch (cause) {
    throwError(cause, message);
  }
}

function doesNotReject(asyncFn, error, message) {
  if (isIgnored(error, message)) {
    return;
  }
  try {
    expect(asyncFn).rejects.toThrow(error);
  } catch (cause) {
    throwError(cause, message);
  }
}

function doesNotThrow(fn, error, message) {
  if (isIgnored(error, message)) {
    return;
  }
  todo("doesNotThrow");
}

function equal(actual, expected, message) {
  if (isIgnored(expected, message)) {
    return;
  }
  try {
    expect(actual).toBe(expected);
  } catch (cause) {
    throwError(cause, message);
  }
}

function fail(actual, expected, message, operator, stackStartFn) {
  if (isIgnored(expected, message)) {
    return;
  }
  todo("fail");
}

function ifError(value) {
  if (isIgnored(value)) {
    return;
  }
  todo("ifError");
}

function match(string, regexp, message) {
  if (isIgnored(regexp, message)) {
    return;
  }
  try {
    expect(string).toMatch(regexp);
  } catch (cause) {
    throwError(cause, message);
  }
}

function notDeepEqual(actual, expected, message) {
  if (isIgnored(expected, message)) {
    return;
  }
  todo("notDeepEqual");
}

function notDeepStrictEqual(actual, expected, message) {
  if (isIgnored(expected, message)) {
    return;
  }
  todo("notDeepStrictEqual");
}

function notEqual(actual, expected, message) {
  if (isIgnored(expected, message)) {
    return;
  }
  try {
    expect(actual).not.toBe(expected);
  } catch (cause) {
    throwError(cause, message);
  }
}

function notStrictEqual(actual, expected, message) {
  if (isIgnored(expected, message)) {
    return;
  }
  try {
    expect(actual).not.toStrictEqual(expected);
  } catch (cause) {
    throwError(cause, message);
  }
}

function ok(value, message) {
  if (isIgnored(message)) {
    return;
  }
  equal(!!value, true, message);
}

function rejects(asyncFn, error, message) {
  if (isIgnored(error, message)) {
    return;
  }
  todo("rejects");
}

function strictEqual(actual, expected, message) {
  if (isIgnored(expected, message)) {
    return;
  }
  try {
    expect(actual).toBe(expected);
  } catch (cause) {
    throwError(cause, message);
  }
}

function throws(fn, error, message) {
  try {
    let result;
    try {
      result = fn();
    } catch (cause) {
      const matcher = toErrorMatcher(error);
      expect(cause).toEqual(matcher);
      return;
    }
    expect(result).toBe("Expected function to throw an error, instead it returned");
  } catch (cause) {
    throwError(cause, message);
  }
}

function toErrorMatcher(expected) {
  let message;
  if (typeof expected === "string") {
    message = expected;
  } else if (expected instanceof RegExp) {
    message = expected.source;
  } else if (typeof expected === "object") {
    message = expected.message;
  }

  for (const [expected, actual] of similarErrors) {
    if (message && expected.test(message)) {
      message = actual;
      break;
    }
  }

  if (!message) {
    return expect.anything();
  }

  if (typeof expected === "object") {
    return expect.objectContaining({
      ...expected,
      message: expect.stringMatching(message),
    });
  }

  return expect.stringMatching(message);
}

const similarErrors = [
  [/Invalid typed array length/i, /length too large/i],
  [/Unknown encoding/i, /Invalid encoding/i],
  [
    /The ".*" argument must be of type string or an instance of Buffer or ArrayBuffer/i,
    /Invalid input, must be a string, Buffer, or ArrayBuffer/i,
  ],
  [/The ".*" argument must be an instance of Buffer or Uint8Array./i, /Expected Buffer/i],
  [/The ".*" argument must be an instance of Array./i, /Argument must be an array/i],
  [/The value of ".*" is out of range./i, /Offset is out of bounds/i],
  [/Attempt to access memory outside buffer bounds/i, /Out of bounds access/i],
];

const ignoredExpectations = [
  // Reason: Bun has a nicer format for `Buffer.inspect()`.
  /^<Buffer /,
];

function isIgnored(...expectations) {
  for (const expected of expectations) {
    let query;
    if (typeof expected === "string") {
      query = expected;
    } else if (expected instanceof RegExp) {
      query = expected.source;
    } else {
      continue;
    }
    for (const pattern of ignoredExpectations) {
      if (pattern.test(query)) {
        console.warn("Ignoring expectation:", expected);
        return true;
      }
    }
  }
  return false;
}

function throwError(error, message) {
  if (isIgnored(error, message)) {
    return;
  }

  if (typeof message === "string") {
    const gray = "\x1b[90m";
    const reset = "\x1b[0m";
    error.message += `\n${gray}note: ${message}${reset}`;
  }

  throw error;
}

function todo(name) {
  throw new Error(`TODO: ${name}`);
}

export default ok;
export {
  deepEqual,
  deepStrictEqual,
  doesNotMatch,
  doesNotReject,
  doesNotThrow,
  equal,
  fail,
  ifError,
  match,
  notDeepEqual,
  notDeepStrictEqual,
  notEqual,
  notStrictEqual,
  ok,
  rejects,
  strictEqual,
  throws,
};
