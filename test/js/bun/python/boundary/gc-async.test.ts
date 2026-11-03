// Coroutines and async generators that JavaScript drops.
import { expect, setDefaultTimeout, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import asyncio from "python:asyncio";
import { dict, exec, len } from "python:builtins";

// These builds take seconds to start Python, and longer to import asyncio.
if (isDebug || isASAN) setDefaultTimeout(120_000);

const globals = dict([["__name__", "fixture"]]);
exec(
  `
log = []

async def waits(name, awaitable):
    try:
        await awaitable
    finally:
        log.append("finally " + name)

async def generator(name):
    try:
        yield 1
        yield 2
    finally:
        log.append("finally " + name)

def take():
    taken = list(log)
    log.clear()
    return taken
`,
  globals,
);
const { waits, generator, take, log } = globals;

async function collectUntil(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) {
    Bun.gc(true);
    await new Promise(resolve => setImmediate(resolve));
  }
  return condition();
}

test("an async generator is closed by break", async () => {
  for await (const _ of generator("break")) break;
  expect(take()).toEqual(["finally break"]);
});

test("an async generator that is dropped half way is closed when it is collected", async () => {
  await (async () => void (await generator("dropped")[Symbol.asyncIterator]().next()))();
  expect(await collectUntil(() => log.length > 0)).toBe(true);
  expect(take()).toEqual(["finally dropped"]);
});

test("an async function of JavaScript that waits for what nobody can settle is collected", async () => {
  let collected = false;
  const registry = new FinalizationRegistry(() => void (collected = true));
  (() => {
    const held = {};
    registry.register(held, 0);
    (async () => {
      await new Promise(() => {});
      return held;
    })();
  })();
  expect(await collectUntil(() => collected)).toBe(true);
});

// The tasks of the coroutines that JavaScript has called are in a set for as long as they are not done.
test.failing("and so is a coroutine", async () => {
  (() => void waits("for ever", new Promise(() => {})))();
  expect(await collectUntil(() => log.length > 0)).toBe(true);
  expect(take()).toEqual(["finally for ever"]);
  expect(len(asyncio.all_tasks())).toBe(0);
});

test("nothing is left of coroutines that are done", async () => {
  const before = len(asyncio.all_tasks());
  for (let i = 0; i < 100; i++) await waits("done", Promise.resolve(i));
  expect(take()).toHaveLength(100);
  expect(len(asyncio.all_tasks())).toBe(before);
});
