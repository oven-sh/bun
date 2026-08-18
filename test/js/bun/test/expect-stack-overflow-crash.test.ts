import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: calling expect matchers after catching a stack overflow
// should not crash with a releaseAssertNoException assertion failure.
test("expect does not crash when called after catching stack overflow", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `var a=false,b=false;
function r(){r()}
try{r()}catch(e){a=true}
try{Bun.jest().expect(42).toBeFalse()}catch(e){b=true}
if(a&&b)console.log("OK")`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});

// toMatchObject and Bun.deepMatch recurse natively into nested objects. A
// chain deeper than the native stack must throw RangeError, not segfault.
test.concurrent.each([
  ["expect().toMatchObject()", "Bun.jest().expect(ra).toMatchObject(rb)"],
  ["Bun.deepMatch()", "Bun.deepMatch(rb, ra)"],
])("%s throws RangeError on deeply nested objects instead of crashing", async (_, compare) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let a = {}, b = {};
const ra = a, rb = b;
for (let i = 0; i < 100000; i++) { a.x = {}; b.x = {}; a = a.x; b = b.x; }
try {
  ${compare};
  console.log("no throw");
} catch (e) {
  console.log(e instanceof RangeError, e.message);
}`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("true Maximum call stack size exceeded.\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// A failing matcher formats the received and the expected value for its message.
// The formatter reads `$$typeof` from every object, so a `$$typeof` getter that
// throws makes formatting that object throw. The exception used to stay pending
// while the remaining properties and the other value were formatted. Debug builds
// asserted on the next native call. Release builds dropped the property, or threw
// the getter's error instead of the matcher's error.
describe.concurrent("failing matcher when formatting a value throws", () => {
  // Properties are formatted in code point order. On the Bun object, "A0" comes
  // right before "Archive", which is initialized lazily by native code, and "B0"
  // comes after it.
  const marker = "formatted-after-the-throwing-property";

  async function run(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("the property that throws ends the walk of that object", async () => {
    const result = await run(`
      Bun.A0 = { get $$typeof() { throw new Error("boom"); } };
      Bun.B0 = ${JSON.stringify(marker)};
      try {
        Bun.jest().expect({}).toStrictEqual(Bun);
      } catch (e) {
        console.log(e.message.split("\\n")[0], e.message.includes(${JSON.stringify(marker)}));
      }
    `);
    expect(result).toEqual({
      stdout: "expect(received).toStrictEqual(expected) false\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("the exception also ends the walk of the enclosing object", async () => {
    const result = await run(`
      const a = {};
      Object.defineProperty(a, "$$typeof", { get() { throw new Error("boom"); } });
      const received = { x: { a, b: ${JSON.stringify(marker)} }, y: ${JSON.stringify(marker)} };
      try {
        Bun.jest().expect(received).toEqual({});
      } catch (e) {
        console.log(e.message.split("\\n")[0], e.message.includes(${JSON.stringify(marker)}));
      }
    `);
    expect(result).toEqual({
      stdout: "expect(received).toEqual(expected) false\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("the matcher throws its own error when the received value itself cannot be formatted", async () => {
    const result = await run(`
      const received = {};
      Object.defineProperty(received, "$$typeof", { get() { throw new Error("boom"); } });
      try {
        Bun.jest().expect(received).toEqual({ a: 1 });
      } catch (e) {
        console.log(JSON.stringify(e.message));
      }
    `);
    const message = JSON.parse(result.stdout);
    expect(message).toStartWith("expect(received).toEqual(expected)\n\n");
    expect(message).toContain('"a": 1');
    expect(message).not.toContain("boom");
    expect(result).toMatchObject({ stderr: "", exitCode: 0 });
  });

  test("a getter that overflows the stack while the message is formatted", async () => {
    // The getter is plain JavaScript, so it only throws once the stack is
    // exhausted. The matcher runs in the three deepest frames that caught the
    // overflow, like the fuzzer-generated program this test comes from.
    const result = await run(`
      function helper() { return undefined; }
      Bun.A0 = { get $$typeof() { return helper(); } };
      Bun.B0 = ${JSON.stringify(marker)};
      const errors = [];
      function F() {
        try { new F(); } catch {}
        if (errors.length < 3) {
          const jest = Bun.jest();
          try { jest.expect(jest).toStrictEqual(Bun); } catch (e) { errors.push(e); }
        }
      }
      new F();
      for (const e of errors) {
        console.log(e.constructor.name, e.message.split("\\n")[0], e.message.includes(${JSON.stringify(marker)}));
      }
    `);
    expect(result).toEqual({
      stdout: Array(3).fill("Error expect(received).toStrictEqual(expected) false\n").join(""),
      stderr: "",
      exitCode: 0,
    });
  });

  // Other places where the formatter runs user code. None of them is reached by
  // the comparison itself, so only the message formatting throws.
  const throwingValues = {
    "a RegExp whose toString throws": `
      const value = /abc/;
      Object.defineProperty(value, "toString", { value() { throw new Error("boom"); } });
    `,
    "an array Proxy whose get trap throws": `
      const value = new Proxy([1], { get() { throw new Error("boom"); } });
    `,
    "an object whose Symbol.toStringTag getter throws": `
      const value = { a: 1 };
      Object.defineProperty(value, Symbol.toStringTag, { get() { throw new Error("boom"); } });
    `,
  };

  test.each(Object.entries(throwingValues))("%s on either side of the diff", async (_, makeValue) => {
    const result = await run(`
      ${makeValue}
      const { expect } = Bun.jest();
      for (const assertion of [() => expect(value).toEqual({ z: 9 }), () => expect({ z: 9 }).toEqual(value)]) {
        try {
          assertion();
        } catch (e) {
          console.log(e.message.split("\\n")[0]);
        }
      }
    `);
    expect(result).toEqual({
      stdout: "expect(received).toEqual(expected)\nexpect(received).toEqual(expected)\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("matcherHint renders the same diff for a custom matcher", async () => {
    const result = await run(`
      ${throwingValues["an object whose Symbol.toStringTag getter throws"]}
      const { expect } = Bun.jest();
      expect.extend({
        toBeHinted() {
          console.log(this.utils.matcherHint("toBeHinted", value, { z: 9 }).split("\\n")[0]);
          return { pass: true, message: () => "" };
        },
      });
      try {
        expect(value).toBeHinted();
      } catch (e) {
        console.log(e.message.split("\\n")[0]);
      }
    `);
    expect(result).toEqual({
      stdout: "expect(received).toBeHinted(expected)\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
