import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// StructureFlag: ~IsImmutablePrototypeExoticObject
//
// Some libraries like `web-worker` override the prototype on `globalThis` to add extra properties.
test("Object.setPrototypeOf works on globalThis", () => {
  const orig = Object.getPrototypeOf(globalThis);
  let parent = orig;
  while (parent) {
    for (const key in parent) {
      console.log(key);
    }
    parent = Object.getPrototypeOf(parent);
  }
  Object.setPrototypeOf(
    globalThis,
    Object.create(null, {
      a: {
        value: 1,
      },
    }),
  );
  expect(
    // @ts-expect-error
    a,
  ).toBe(1);

  Object.setPrototypeOf(globalThis, orig);

  expect(
    // @ts-expect-error
    globalThis.a,
  ).toBeUndefined();
});

// The ESM registry map is initialized lazily by reading globalThis.Loader.registry. If
// the global's prototype chain has a Proxy with a throwing `has` trap, or Loader has been
// replaced with a non-object, or Loader.registry is not a Map, Bun should not crash.
test.concurrent.each([
  [
    "Proxy has trap throws",
    `delete globalThis.Loader;
     Object.setPrototypeOf(globalThis, new Proxy(Object.getPrototypeOf(globalThis), {
       has() { throw new TypeError("boom"); },
     }));`,
  ],
  ["Loader is not an object", `globalThis.Loader = 42;`],
  ["Loader.registry is not a Map", `globalThis.Loader = { registry: {} };`],
])("require() does not crash when globalThis.Loader is tampered with (%s)", async (_, setup) => {
  using dir = tempDir("loader-tamper", {
    "mod.js": "module.exports = 1;",
    "entry.js": `${setup}
       try { require("./mod.js"); } catch {}
       console.log("ok");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: expect.any(String), exitCode: 0 });
});
