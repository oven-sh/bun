import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// See https://github.com/oven-sh/bun/pull/2939
test("non-ascii property name", () => {
  const { stdout } = Bun.spawnSync({
    cmd: [bunExe(), "run", require("path").join(import.meta.dir, "./property-non-ascii-fixture.js")],
    env: bunEnv,
  });
  const filtered = stdout.toString().replaceAll("\n", "").replaceAll(" ", "");
  expect(filtered).toBe(
    `{
      "código": 1,
      "código2": 2,
      "código3": 3,
      "código4": 4,
      "código5": 5,
      "😋 Get ": 6,
    } 1 1 2 3 4 3 2 4 5 2 6 6 6 6 6 6 6 6
`
      .replaceAll("\n", "")
      .replaceAll(" ", ""),
  );
  // just to be sure
  expect(Buffer.from(Bun.CryptoHasher.hash("sha1", filtered) as Uint8Array).toString("hex")).toBe(
    "0bf68c8c4a35576ca3e27240565582ddc7c3ed3f",
  );
});

// "{ __proto__: x }" sets the prototype of the object, "{ __proto__ }" and
// "{ ["__proto__"]: x }" define an own property. The runtime transpiler must
// keep each form as written, also when it inlines or renames the value.
test("__proto__ object keys keep their meaning through the runtime transpiler", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
        const P = { isP: true };
        function colon(__proto__) { return { __proto__: __proto__ }; }
        function quoted(__proto__) { return { "__proto__": __proto__ }; }
        function computed(__proto__) { return { ["__proto__"]: __proto__ }; }
        function shorthand(__proto__) { return { __proto__ }; }
        // the single-use "let" gets inlined into the shorthand property
        function shorthandInlined(proto) { let __proto__ = proto; return { __proto__ }; }
        function colonInlined(proto) { let __proto__ = proto; return { __proto__: __proto__ }; }
        function shorthandNested(proto) { { let __proto__ = proto; return { __proto__ }; } }
        function method() { return { __proto__() { return 1; } }; }
        function accessor() { return { get __proto__() { return 2; } }; }
        function spread(__proto__) { return { a: 1, ...{ b: 2, __proto__ }, c: 3 }; }
        class Field { __proto__ = P; }
        function destructure(o) { let __proto__ = null; ({ __proto__ } = o); return __proto__; }
        function describe(o) {
          return [Object.getPrototypeOf(o) === P, Object.hasOwn(o, "__proto__")];
        }
        console.log(JSON.stringify({
          colon: describe(colon(P)),
          quoted: describe(quoted(P)),
          computed: describe(computed(P)),
          shorthand: describe(shorthand(P)),
          shorthandInlined: describe(shorthandInlined(P)),
          colonInlined: describe(colonInlined(P)),
          shorthandNested: describe(shorthandNested(P)),
          method: describe(method()),
          accessor: describe(accessor()),
          spread: describe(spread(P)),
          field: describe(new Field()),
          destructure: destructure({ ["__proto__"]: 42 }),
        }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    colon: [true, false],
    quoted: [true, false],
    computed: [false, true],
    shorthand: [false, true],
    shorthandInlined: [false, true],
    colonInlined: [true, false],
    shorthandNested: [false, true],
    method: [false, true],
    accessor: [false, true],
    spread: [false, true],
    field: [false, true],
    destructure: 42,
  });
  expect(exitCode).toBe(0);
});
