// `globalThis.self` is an accessor whose setter replaces it with what it is given. A program may take the setter (`__lookupSetter__`, a descriptor) and call it.
// A build that sees that leaves `self` open. The lowest layer of a test run is built before the files above it are read as code, and locks `self` unless they spell a store to it.
// There the setter did nothing and said nothing: `self` stayed the global object. Now it throws what `globalThis.self = 1` throws there, and the run lists it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const ways = {
  "__lookupSetter__": `globalThis.__lookupSetter__("self")`,
  "a descriptor": `Object.getOwnPropertyDescriptor(globalThis, "self").set`,
};

async function run(setter: string, flags: string[], words?: string) {
  using dir = tempDir("aot-setter-of-self", {
    "program.mjs": `
      const set = ${setter};
      let outcome = "set";
      try { ["replaced"].forEach(value => set.call({}, value)); } catch (error) { outcome = error.constructor.name + ": " + error.message.slice(0, 21); }
      console.error("OUT", outcome, typeof self, "value" in Object.getOwnPropertyDescriptor(globalThis, "self"));`,
    "a.test.mjs": `import { test } from "bun:test";\ntest("t", async () => { await import("./program.mjs"); });`,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr] = await Promise.all([child.stderr.text(), child.exited]);
  return stderr.split("\n").filter(line => line.startsWith("OUT"));
}

test.concurrent.each(Object.entries(ways))(
  "taken by %s",
  async (_, setter) => {
    const plain = await run(setter, []);
    expect(plain).toEqual(["OUT set string true"]);
    expect(await run(setter, ["--aot"])).toEqual(plain);
    // Either answer is honest. "OUT set object false" is not.
    expect([plain, ["OUT TypeError: Cannot assign to self object false"]]).toContainEqual(
      await run(setter, ["--aot"], "TestRunLayers:2"),
    );
  },
  240_000,
);
