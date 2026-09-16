// Several JSC builtins keep one entry per script-controlled item in a
// `WTF::Vector`: a match of `replaceAll`, a piece of `split`, an element of the
// array that `JSON.parse` hands to a reviver. They grew that Vector with the
// infallible `append()`. When the Vector could not grow, the process died
// (`panic(main thread): abort() called`, exit code 134, or a segfault at
// 0xBBADBEEF), also inside try/catch. They now throw `RangeError: Out of memory`
// (oven-sh/WebKit#666).
//
// A Vector cannot grow when its allocation fails, or when it would pass 2^31
// bytes. The first block makes the allocation fail, which takes a few hundred
// thousand items, and covers every site. The cap it uses exists in debug WTF
// only, and ASAN's cap does not reach WTF allocations. The last test reaches
// the 2^31 byte limit for real, with the cheapest of the builtins, so that
// release builds run one of them too.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { totalmem } from "node:os";

const KiB = 1024;
const GiB = 1024 ** 3;

// `BUN_JSC_maxSingleAllocationSize` makes every WTF `try*` allocation above the
// cap return null, and every other WTF allocation above it crash. Bun needs one
// allocation of 144 KiB to start. A debug build pays about 20 µs per match of
// replaceAll or split for a lifetime check on every StringView, so the cap is
// not higher than this.
const cap = 384 * KiB;

// A Vector grows by 1.5x and its entries here are 4 bytes or more, so the first
// allocation above the cap comes before 0.375 * cap entries. Every string below
// takes 2 bytes per item or less, which keeps it under the cap.
const prelude = /* js */ `
  const items = Math.floor(0.4 * ${cap});
  const string = (unit, encoding = "latin1") =>
    Buffer.alloc(items * Buffer.byteLength(unit, encoding), unit, encoding).toString(encoding);
  let closed = false;
  const iterable = value => ({
    [Symbol.iterator]() {
      let i = 0;
      return {
        next: () => (i++ < items ? { done: false, value } : { done: true }),
        return: () => ((closed = true), {}),
      };
    },
  });
  const registry = new FinalizationRegistry(() => {});
  const target = {};
  const token = {};
  const registerMany = token => {
    for (let i = 0; i < items; i++) registry.register(target, 1, token);
  };
  const registerWithTokensThatDie = () => {
    for (let i = 0; i < 100; i++) registry.register(target, 2, {});
  };
  const emptyModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
`;

// [the call that runs out of memory, a call of the same builtin after it, the result of that call]
const cases: Record<string, [string, string, unknown]> = {
  "String.prototype.replaceAll(string, string)": [
    `string("a").replaceAll("a", "c")`,
    `"banana".replaceAll("a", "o")`,
    "bonono",
  ],
  "String.prototype.replaceAll with an empty search string": [
    `string("a").replaceAll("", "c")`,
    `"ab".replaceAll("", "-")`,
    "-a-b-",
  ],
  "String.prototype.replace(regexp, string) with many $ references": [
    `"x".replace(/(x)/g, string("$1"))`,
    `"x".replace(/(x)/g, "[$1$$$&]")`,
    "[x$x]",
  ],
  "String.prototype.split with a separator of one character": [
    `string(",").split(",")`,
    `"a,b,,c".split(",")`,
    ["a", "b", "", "c"],
  ],
  "String.prototype.split of a 16-bit string": [
    `string("\\u3042", "utf16le").split("\\u3042")`,
    `"a\\u3042b".split("\\u3042")`,
    ["a", "b"],
  ],
  "String.prototype.split with a longer separator": [
    `string(",;").split(",;")`,
    `"a,;b,;".split(",;")`,
    ["a", "b", ""],
  ],
  "JSON.parse with a reviver": [
    `JSON.parse("[" + string("1,") + "1]", (key, value) => value)`,
    `JSON.parse("[1,[2,3]]", (key, value) => value)`,
    [1, [2, 3]],
  ],
  "FinalizationRegistry.prototype.register": [
    `registerMany(undefined)`,
    `(registry.register(target, 1, token), registry.unregister(token))`,
    true,
  ],
  "FinalizationRegistry.prototype.register with an unregister token": [
    `registerMany(token)`,
    `[registry.unregister(token), registry.unregister(token)]`,
    [true, false],
  ],
  // The throw leaves the list of the registrations without a token full. The
  // end of a collection moves a registration there when its token dies before
  // its target. Nothing can throw at that point, so JSC drops the registration.
  "FinalizationRegistry: a token that dies when the list without tokens is full": [
    `registerMany(undefined)`,
    `(registerWithTokensThatDie(), Bun.gc(true), registry.register(target, 3, token), registry.unregister(token))`,
    true,
  ],
  "Intl.ListFormat.prototype.format": [
    `new Intl.ListFormat("en").format(iterable("a"))`,
    `new Intl.ListFormat("en").format(["a", "b", "c"])`,
    "a, b, and c",
  ],
  "Intl.ListFormat.prototype.formatToParts": [
    `new Intl.ListFormat("en").formatToParts(iterable("a"))`,
    `new Intl.ListFormat("en").formatToParts(["a"]).length`,
    1,
  ],
  "WebAssembly.Tag parameters": [
    `new WebAssembly.Tag({ parameters: iterable("i32") })`,
    `new WebAssembly.Tag({ parameters: ["i32"] }) instanceof WebAssembly.Tag`,
    true,
  ],
  "WebAssembly compile option builtins": [
    `WebAssembly.validate(emptyModule, { builtins: iterable("js-string") })`,
    `WebAssembly.validate(emptyModule, { builtins: ["js-string"] })`,
    true,
  ],
};

async function run(script: string, env: NodeJS.Dict<string>) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout, `the child printed nothing and exited with ${exitCode}\nstderr:\n${stderr}`).not.toBe("");
  return { ...JSON.parse(stdout), stderr, exitCode };
}

const attempt = (call: string, after: string) => /* js */ `
  const result = {};
  try {
    ${call};
    result.error = "did not throw";
  } catch (e) {
    result.error = e.name + ": " + e.message;
  }
  result.after = ${after};
`;

describe.skipIf(!isDebug)("a builtin whose Vector fails to allocate throws instead of ending the process", () => {
  test.concurrent.each(Object.entries(cases))("%s", async (_, [tooMany, after, expected]) => {
    const script = `${prelude}${attempt(tooMany, after)}
      result.iteratorClosed = closed;
      console.log(JSON.stringify(result));`;
    expect(await run(script, { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(cap) })).toEqual({
      error: "RangeError: Out of memory",
      after: expected,
      iteratorClosed: tooMany.includes("iterable("),
      stderr: "",
      exitCode: 0,
    });
  });
});

// The Vector of split holds 4 bytes per piece, so 2^29 pieces cannot fit in
// 2^31 bytes. It grows by 1.5x from 256 entries, and the growth step at the
// 372,712,672nd piece is the one that asks for more than that. The child peaks
// at 3.7 GB, so the test has the 10 GiB gate of the other tests that need about
// 4 GB (error-message-string-length-limit.test.ts). A 16 GiB CI machine reports
// a little less than 16 GiB and passes that gate; the 8 GiB Linux agents skip
// the test, because this directory runs in the parallel batch. (Inside a
// container os.totalmem() reports the host's RAM; process.constrainedMemory()
// reports the cgroup limit there.) A release build takes about 3 seconds on a
// fast machine, which is too close to the default 5 second limit, so this one
// test carries its own ceiling. A release ASAN build takes 14 seconds and a
// debug build takes minutes, so they skip it. `repeat` is fast in a release
// build and allocates the 512 MiB once, where
// `Buffer.alloc(n, fill).toString()` allocates it twice.
const memory = Math.min(totalmem(), process.constrainedMemory() || Infinity);
test.skipIf(isDebug || isASAN || memory < 10 * GiB)(
  "String.prototype.split with more pieces than a Vector holds throws instead of aborting the process",
  async () => {
    const script = `${attempt(`",".repeat(2 ** 29).split(",")`, `"a,b".split(",")`)}
      console.log(JSON.stringify(result));`;
    expect(await run(script, bunEnv)).toEqual({
      error: "RangeError: Out of memory",
      after: ["a", "b"],
      stderr: "",
      exitCode: 0,
    });
  },
  30_000,
);
