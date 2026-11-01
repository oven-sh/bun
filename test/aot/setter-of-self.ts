// For ./setter-of-self-<part>.test.ts.
// `self` is an accessor of the global object whose setter puts what it is handed in the accessor's place: `globalThis.__lookupSetter__("self").call({}, "x"); typeof self` is "string".
// As one program the build follows the setter to its call. Over layers the run has to know which members its tests replace before the first build, from a look at each file by itself.
// That look knew `globalThis.self = "x"` and not the setter:
// "TypeError: Cannot assign to self because built-in objects are read-only in compiled code, and the build didn't see a test replace this one".
// Whoever asks the global object for the setter of such a member, or for its descriptor, is taken for somebody who writes it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const ways = {
  "looked up and called": `globalThis.__lookupSetter__("self").call({}, "put");`,
  "looked up and kept": `const set = globalThis.__lookupSetter__("self"); set.call(globalThis, "put");`,
  "looked up and applied": `Reflect.apply(globalThis.__lookupSetter__("self"), undefined, ["put"]);`,
  "looked up with a borrowed method": `Object.prototype.__lookupSetter__.call(globalThis, "self").call({}, "put");`,
  "looked up under a name in a constant": `const name = "self"; globalThis.__lookupSetter__(name).call({}, "put");`,
  "out of the descriptor": `Object.getOwnPropertyDescriptor(globalThis, "self").set.call({}, "put");`,
  "out of the descriptor that Reflect gives": `Reflect.getOwnPropertyDescriptor(globalThis, "self").set.call({}, "put");`,
  "out of all the descriptors": `Object.getOwnPropertyDescriptors(globalThis).self.set.call({}, "put");`,
  "taken apart": `const { set } = Object.getOwnPropertyDescriptor(globalThis, "self"); set("put");`,
  "a plain store": `globalThis.self = "put";`,
};

async function linesOf(body: string, flags: string[]) {
  using dir = tempDir("aot-setter-of-self", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "one.mjs": `${body}\nconsole.error("OUT", typeof self, typeof globalThis.self, self);`,
    "one.test.mjs": `import { test } from "bun:test";\ntest("t", async () => { await import("./one.mjs"); });`,
    "two.test.mjs": `import { test } from "bun:test";\ntest("u", () => { ${body}\nconsole.error("OUT", typeof self, typeof globalThis.self, self); });`,
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return {
    lines: stderr
      .split("\n")
      .filter(line => /^(OUT|error|TypeError)/.test(line))
      .sort(),
    exitCode,
  };
}

export const whoeverIsHandedTheSetterWritesIt = (part: number, parts: number) =>
  test.concurrent.each(Object.entries(ways).filter((_, index) => index % parts === part - 1))(
    "%s",
    async (_, body) => {
      const plain = await linesOf(body, ["--parallel=2"]);
      expect(plain).toEqual({ lines: ["OUT string string put", "OUT string string put"], exitCode: 0 });
      expect(await linesOf(body, ["--aot", "--parallel=2"])).toEqual(plain);
      // More source than fits the memory as one program: the run is built in layers.
      expect(await linesOf(body, ["--aot", "--parallel=2", "--aot-memory-limit=1KB"])).toEqual(plain);
    },
    240_000,
  );
