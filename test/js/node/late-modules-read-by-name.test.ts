import { expect, test } from "bun:test";
import { bunExe, isWindows } from "harness";
import { join } from "node:path";
import { run } from "../../aot/harness/run";

const expected = [
  // -2 is ENOENT on POSIX. libuv has its own number for it on Windows.
  isWindows
    ? "errno Error open Unknown system error -2 orig Unknown system error -2 -2 open"
    : "errno Error open ENOENT orig ENOENT -2 open",
  "keys _errnoException,_extend,callbackify,convertProcessSignalToExitCode,debug,debuglog,deprecate,format,styleText,formatWithOptions,getCallSites,getSystemErrorMap,getSystemErrorName,getSystemErrorMessage,inherits,inspect,isDeepStrictEqual,promisify,setTraceSigInt,stripVTControlCharacters,toUSVString,aborted,types,parseEnv,parseArgs,TextDecoder,TextEncoder,MIMEType,MIMEParams,isArray,isBoolean,isBuffer,isNull,isNullOrUndefined,isNumber,isString,isSymbol,isUndefined,isRegExp,isObject,isDate,isError,isFunction,isPrimitive,log",
  "descriptor true true",
  'format a:1.5:{"b":1} \u001b[33m1\u001b[39m x',
  "buffer 176",
  "buffer4 <Buffer 01 01 01 01 ... 56 more bytes>",
  'style "\\u001b[31mx\\u001b[39m" "y"',
  "style error ERR_INVALID_ARG_TYPE",
  "style error ERR_INVALID_ARG_VALUE",
  "set mine true 7",
  "derived [ false, 'number' ]",
  isWindows ? "globSync [ 'a.txt', 'd\\\\b.txt' ]" : "globSync [ 'a.txt', 'd/b.txt' ]",
  isWindows ? "glob [ 'a.txt', 'd\\\\b.txt' ]" : "glob [ 'a.txt', 'd/b.txt' ]",
  "glob promises [ 'a.txtfalse', 'b.txtfalse', 'dtrue' ]",
  "fh function function function",
  "pullSync [ 'a' ]",
  "closed",
  "agent socket Socket true",
  "get ok:/x",
  "lookup [ null, 'string', 'number', 'localhost' ]",
  "refused Error connect ECONNREFUSED 127.0.0.1:1 ECONNREFUSED connect 127.0.0.1 1",
  "fromWeb [ <Buffer 71> ] ReadableStream",
  "writable [ 'k' ] WritableStream",
  "duplex [ 'readable', 'writable' ] Duplex",
  "dgram hi",
  "stdio3 Socket three",
  "snapshot h.heapsnapshot true",
  "h2 inspect Http2Stream {",
  "  id: 1,",
  " ",
  "h2 Http2Stream {",
  "  id: '<pe h",
  "debuglog enabled undefined",
];

test("members of modules that are loaded late", async () => {
  const { stdout, stderr, exitCode } = await run([
    bunExe(),
    join(import.meta.dir, "late-modules-read-by-name-fixture.js"),
  ]);
  expect({ lines: stdout.trimEnd().split("\n"), stderr, exitCode }).toEqual({
    lines: expected,
    stderr: "",
    exitCode: 0,
  });
});
