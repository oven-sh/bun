import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The exports of a module mock are read from the object that its factory returned, so spyOn() on a namespace object spies on that object:
// also on the namespace object of a file that only hands the name on. What such a file's record has found is looked for again once the mock has ended.
const dep = `export function fn() { return "real-fn"; } export function other() { return "real-other"; } export const value = "real";`;
const head = `import { test, vi, mock } from "bun:test";
const said = run => { try { return String(run()); } catch (error) { return error.constructor.name + ": " + error.message.slice(0, 60); } };`;
const projects: Record<string, Record<string, string>> = {
  "a star": {
    "dep.js": dep,
    "star.js": `export * from "./dep.js";`,
    "x.test.js": `${head}
import * as ns from "./dep.js";
import * as star from "./star.js";
const exports = vi.hoisted(() => ({ fn: () => "fn" }));
vi.mock("./dep.js", () => exports);
test("t", () => {
  const spy = vi.spyOn(star, "fn").mockReturnValue("spied");
  console.log("SEEN", exports.fn === spy, ns.fn(), star.fn());
  spy.mockRestore();
  console.log("SEEN", ns.fn(), star.fn());
});`,
  },
  "a name handed on": {
    "dep.js": dep,
    "named.js": `export { fn } from "./dep.js";`,
    "x.test.js": `${head}
import * as ns from "./dep.js";
import * as named from "./named.js";
const exports = vi.hoisted(() => ({ fn: () => "fn" }));
vi.mock("./dep.js", () => exports);
test("t", () => {
  const spy = vi.spyOn(named, "fn").mockReturnValue("spied");
  console.log("SEEN", exports.fn === spy, ns.fn(), named.fn());
  spy.mockRestore();
  console.log("SEEN", ns.fn(), named.fn());
});`,
  },
  "two stars deep, another name, and an import that is exported": {
    "dep.js": dep,
    "star.js": `export * from "./dep.js";`,
    "outer.js": `export * from "./star.js";`,
    "renamed.js": `export { fn as again } from "./dep.js";`,
    "local.js": `import { other } from "./dep.js"; export { other as third };`,
    "bindings.js": `import { fn } from "./outer.js"; import { again } from "./renamed.js"; import { third } from "./local.js"; export const seen = () => [fn(), again(), third()].join();`,
    "x.test.js": `${head}
import * as ns from "./dep.js";
import * as outer from "./outer.js";
import * as renamed from "./renamed.js";
import * as local from "./local.js";
import { seen } from "./bindings.js";
const exports = vi.hoisted(() => ({ fn: () => "fn", other: () => "other" }));
vi.mock("./dep.js", () => exports);
test("outer", () => {
  const spy = vi.spyOn(outer, "fn").mockReturnValue("spied");
  console.log("SEEN", exports.fn === spy, ns.fn(), outer.fn(), renamed.again(), seen());
  spy.mockRestore();
  console.log("SEEN", ns.fn(), outer.fn(), seen());
});
test("renamed", () => {
  const spy = vi.spyOn(renamed, "again").mockReturnValue("spied");
  console.log("SEEN", exports.fn === spy, "again" in exports, ns.fn(), outer.fn(), renamed.again(), seen());
  spy.mockRestore();
  console.log("SEEN", ns.fn(), renamed.again(), seen());
});
test("local", () => {
  const spy = vi.spyOn(local, "third").mockReturnValue("spied");
  console.log("SEEN", exports.other === spy, ns.other(), local.third(), seen());
  spy.mockRestore();
  console.log("SEEN", ns.other(), local.third(), seen());
});`,
  },
  "a getter, and a name that the mock lacks": {
    "dep.js": dep,
    "star.js": `export * from "./dep.js";`,
    "named.js": `export { other } from "./dep.js";`,
    "x.test.js": `${head}
import * as star from "./star.js";
import * as named from "./named.js";
const exports = vi.hoisted(() => ({ get value() { return "got"; } }));
vi.mock("./dep.js", () => exports);
test("t", () => {
  console.log("SEEN", said(() => {
    const spy = vi.spyOn(star, "value", "get").mockReturnValue("spied");
    const spied = [star.value, exports.value].join();
    spy.mockRestore();
    return spied + " " + [star.value, exports.value].join();
  }));
  console.log("SEEN", said(() => (vi.spyOn(star, "other"), typeof star.other + " " + ("other" in exports))));
  console.log("SEEN", said(() => (vi.spyOn(named, "other"), typeof named.other + " " + ("other" in exports))));
});`,
  },
  "every spy restored, then another": {
    "dep.js": dep,
    "star.js": `export * from "./dep.js";`,
    "x.test.js": `${head}
import * as ns from "./dep.js";
import * as star from "./star.js";
const exports = vi.hoisted(() => ({ fn: () => "fn" }));
vi.mock("./dep.js", () => exports);
test("t", () => {
  vi.spyOn(star, "fn").mockReturnValue("spied");
  console.log("SEEN", ns.fn(), star.fn());
  mock.restore();
  console.log("SEEN", exports.fn(), ns.fn(), star.fn());
  const again = vi.spyOn(star, "fn").mockReturnValue("again");
  console.log("SEEN", exports.fn === again, exports.fn(), ns.fn(), star.fn());
  again.mockRestore();
  console.log("SEEN", exports.fn(), ns.fn(), star.fn());
});`,
  },
  "the next file has no mock": {
    "dep.js": dep,
    "star.js": `export * from "./dep.js";`,
    "bindings.js": `import { fn } from "./star.js"; export const seen = () => fn();`,
    "a.test.js": `${head}
import * as star from "./star.js";
const exports = vi.hoisted(() => ({ fn: () => "fn" }));
vi.mock("./dep.js", () => exports);
test("a", () => {
  const spy = vi.spyOn(star, "fn").mockReturnValue("spied-a");
  console.log("SEEN a", exports.fn === spy, star.fn());
});`,
    "b.test.js": `${head}
import * as ns from "./dep.js";
import * as star from "./star.js";
import { seen } from "./bindings.js";
test("b", () => {
  console.log("SEEN b", ns.fn(), star.fn(), seen());
  const spy = vi.spyOn(star, "fn").mockReturnValue("spied-b");
  console.log("SEEN b", ns.fn(), star.fn(), seen());
  spy.mockRestore();
  console.log("SEEN b", ns.fn(), star.fn(), seen());
});`,
  },
  "two files mock it, a third does not": {
    "dep.js": dep,
    "star.js": `export * from "./dep.js";`,
    "a.test.js": `${head}
import * as star from "./star.js";
const exports = vi.hoisted(() => ({ fn: () => "fn-a" }));
vi.mock("./dep.js", () => exports);
test("a", () => {
  globalThis.exportsOfA = exports;
  const spy = vi.spyOn(star, "fn").mockReturnValue("spied-a");
  console.log("SEEN a", exports.fn === spy, star.fn());
});`,
    "b.test.js": `${head}
import * as ns from "./dep.js";
import * as star from "./star.js";
const exports = vi.hoisted(() => ({ fn: () => "fn-b" }));
vi.mock("./dep.js", () => exports);
test("b", () => {
  console.log("SEEN b", ns.fn(), star.fn());
  const spy = vi.spyOn(star, "fn").mockReturnValue("spied-b");
  console.log("SEEN b", exports.fn === spy, globalThis.exportsOfA?.fn === spy, ns.fn(), star.fn());
  spy.mockRestore();
  const own = vi.spyOn(ns, "fn").mockReturnValue("spied-own");
  console.log("SEEN b", exports.fn === own, globalThis.exportsOfA?.fn === own, ns.fn(), star.fn());
});`,
    "c.test.js": `${head}
import * as star from "./star.js";
test("c", () => {
  console.log("SEEN c", star.fn());
  const spy = vi.spyOn(star, "fn").mockReturnValue("spied-c");
  console.log("SEEN c", star.fn());
  spy.mockRestore();
  console.log("SEEN c", star.fn());
});`,
  },
  "no mock stands": {
    "dep.js": dep,
    "star.js": `export * from "./dep.js";`,
    "bindings.js": `import { fn } from "./star.js"; export const seen = () => fn();`,
    "lays.js": `import { vi } from "bun:test"; export const lay = () => vi.doMock("./dep.js", () => ({ fn: () => "fn" }));`,
    "x.test.js": `${head}
import * as ns from "./dep.js";
import * as star from "./star.js";
import { seen } from "./bindings.js";
import "./lays.js";
test("t", () => {
  const spy = vi.spyOn(star, "fn").mockReturnValue("spied");
  console.log("SEEN", ns.fn(), star.fn(), seen());
  spy.mockRestore();
  console.log("SEEN", ns.fn(), star.fn(), seen());
});`,
  },
};

test.each(Object.keys(projects))(
  "%s: as plain Bun, as one program and in two layers",
  async name => {
    using dir = tempDir("aot-spy-through-barrels", {
      "package.json": `{ "name": "p", "type": "module" }`,
      ...projects[name],
    });
    const seen = async (flags: string[], words: string) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
      return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN"));
    };
    const plain = await seen([], "");
    expect(plain.length).toBeGreaterThan(0);
    expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  600000,
);
