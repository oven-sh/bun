import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// The expected value can be a String object. Its toString() is user code, and it runs after the
// matcher has read the received string. The matcher must own the received characters by then.
const fixture = /* js */ `
const { expect } = Bun.jest();

function deep(n, fn) {
  return n === 0 ? fn() : deep(n - 1, fn);
}
// Overwrites stale stack slots, so that no dead frame keeps the base string reachable.
function clobber(n) {
  let a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8;
  return n === 0 ? a + b + c + d + e + f + g + h : clobber(n - 1) + a + b + c + d + e + f + g + h;
}
let counter = 0;
// slice(2) of a 16-bit string is a substring rope. Its characters live in the base string,
// and only the rope references the base.
function makeReceived() {
  return deep(200, () => ("\\u{1F642}" + "probe_unique_" + counter++ + "_" + "x".repeat(64)).slice(2));
}
// A String object whose toString() resolves \`received\` (the rope drops its base) and collects the base.
function makeExpected(received, result) {
  const expected = new String(result);
  expected.toString = () => {
    ({})[received];
    Bun.gc(true);
    const junk = [];
    for (let i = 0; i < 500; i++) junk.push(("\\u{1F600}" + "zzzzzzzz".repeat(12) + i).slice(1).toUpperCase());
    Bun.gc(true);
    return result;
  };
  return expected;
}

const cases = {
  toStartWith: (received, copy) => expect(received).toStartWith(makeExpected(received, "probe_unique_")),
  toEndWith: (received, copy) => expect(received).toEndWith(makeExpected(received, "xxxx")),
  toInclude: (received, copy) => expect(received).toInclude(makeExpected(received, "_unique_")),
  toIncludeRepeated: (received, copy) => expect(received).toIncludeRepeated(makeExpected(received, "probe"), 1),
  toEqualIgnoringWhitespace: (received, copy) => expect(received).toEqualIgnoringWhitespace(makeExpected(received, copy)),
  toContainEqual: (received, copy) => expect(new String(received)).toContainEqual(makeExpected(received, "p")),
  // Here the thrown message is the String object, and the expected string is the rope.
  toThrow: (received, copy) =>
    expect(() => {
      throw { message: makeExpected(received, "message: " + copy.replaceAll(" ", "")) };
    }).toThrow(received),
};
for (const [name, run] of Object.entries(cases)) {
  const received = makeReceived();
  const copy = Array.from(received).join(" ");
  clobber(400);
  run(received, copy);
  console.log(name, "ok");
}
`;

// Malloc=1 makes bmalloc use the system heap, so that ASAN sees a read of a freed StringImpl.
test.skipIf(!isASAN)("string matchers own the received string before they coerce the expected value", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, Malloc: "1" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe(
    ["toStartWith", "toEndWith", "toInclude", "toIncludeRepeated", "toEqualIgnoringWhitespace", "toContainEqual", "toThrow"]
      .map(name => name + " ok\n")
      .join(""),
  );
  expect(exitCode).toBe(0);
});
