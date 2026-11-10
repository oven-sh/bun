// node:events finds the prototype of async iterators while it loads. A program that afterwards moves what stands above async generators, and calls on() for the first time then, still gets an iterator below the one found at the load.
// Compiled code looks at the first call of on(). That is the same only while no compiled program can move either place: `bun test --aot` is held to refusing both writes.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const asks = (move: string, restore: string) => `import { test } from "bun:test";
import { on, EventEmitter } from "node:events";
test("t", () => {
  const functions = Object.getPrototypeOf(async function* () {}), generators = functions.prototype, iterators = Object.getPrototypeOf(generators);
  ${move};
  let iterator;
  try { iterator = on(new EventEmitter(), "x"); } finally { ${restore}; }
  console.error("SEEN " + (Object.getPrototypeOf(iterator) === iterators) + " " + iterator.marker);
  iterator.return();
});
`;

test("what on answers stands below the prototype found while node:events loads", async () => {
  using dir = tempDir("aot-plain-library", {
    "package.json": `{ "name": "p" }`,
    "link.test.mjs": asks(
      `Object.setPrototypeOf(generators, { marker: "laid" })`,
      `Object.setPrototypeOf(generators, iterators)`,
    ),
    "member.test.mjs": asks(
      `Object.defineProperty(functions, "prototype", { configurable: true, value: Object.create({ marker: "laid" }) })`,
      `Object.defineProperty(functions, "prototype", { configurable: true, value: generators })`,
    ),
  });
  const saidWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    const said = stdout + "\n" + stderr;
    return {
      seen: said.split("\n").filter(line => line.startsWith("SEEN ")),
      refusesLink: said.includes("TypeError: Cannot change the prototype of %AsyncGenerator%.prototype"),
      refusesMember: said.includes("TypeError: Cannot assign to %AsyncGeneratorFunction%.prototype.prototype"),
      exitCode,
    };
  };
  expect(await saidWith()).toEqual({
    seen: ["SEEN true undefined", "SEEN true undefined"],
    refusesLink: false,
    refusesMember: false,
    exitCode: 0,
  });
  expect(await saidWith("--aot")).toEqual({ seen: [], refusesLink: true, refusesMember: true, exitCode: 1 });
});
