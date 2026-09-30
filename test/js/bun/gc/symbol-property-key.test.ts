import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A Symbol that is reachable only as a property key of a live object is live: its WeakMap entry
// stays, a WeakRef to it is not cleared, and Object.getOwnPropertySymbols returns the same symbol.
// JavaScriptCore keeps a property key as its SymbolImpl, not as the Symbol cell; the cell has to
// be kept by the structure that holds the key (oven-sh/bun#44237).
const fixture = /* js */ `
import { edenGC } from "bun:jsc";

// Bun.gc(true) also ends the current job for WeakRef purposes, so a WeakRef made before it does
// not keep its target alive. edenGC does not, so the eden cases make no WeakRef.
const fullGC = () => Bun.gc(true);

// Overwrites stack slots that could still point at a symbol, so that the conservative stack scan
// does not keep it alive by accident.
const scrub = depth => (depth > 0 ? scrub(depth - 1) + depth : 0);

const registry = new WeakMap();
const result = {};

function addKey(object, withRef) {
  const key = Symbol("key");
  registry.set(key, "value");
  object[key] = true;
  return withRef ? new WeakRef(key) : undefined;
}

function lost(object, ref) {
  const keys = Object.getOwnPropertySymbols(object);
  const key = keys[keys.length - 1];
  if (!registry.has(key)) return 1;
  if (ref && ref.deref() !== key) return 1;
  return 0;
}

function run(name, gc, withRef, makeObject) {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const object = makeObject();
    const ref = addKey(object, withRef);
    scrub(100);
    gc();
    count += lost(object, ref);
  }
  result[name] = count;
}

function makeDictionary() {
  const object = {};
  for (let i = 0; i < 130; i++) object["p" + i] = i;
  delete object.p0;
  return object;
}

// The key lives in a structure transition.
run("transition full", fullGC, true, () => ({}));
run("transition eden", edenGC, false, () => ({}));

// The key lives in the property table of a dictionary structure (more than 128 transitions).
run("dictionary full", fullGC, true, makeDictionary);
run("dictionary eden", edenGC, false, makeDictionary);

// An object that is already old gets the key.
const oldDictionary = makeDictionary();
const oldObject = {};
fullGC();
run("old dictionary eden", edenGC, false, () => oldDictionary);
run("old object eden", edenGC, false, () => oldObject);
run("old dictionary full", fullGC, true, () => oldDictionary);

// The key is on a prototype, reached through an instance.
run("prototype full", fullGC, true, () => {
  const proto = {};
  globalThis.keep = Object.create(proto);
  return proto;
});

// The value of the WeakMap entry reaches the object that has the symbol as a key: the cycle is
// still collected.
{
  const ref = (() => {
    const key = Symbol("cycle");
    const object = { [key]: 1 };
    registry.set(key, object);
    return new WeakRef(key);
  })();
  scrub(100);
  fullGC();
  result["ephemeron cycle collected"] = ref.deref() === undefined;
}

console.log(JSON.stringify(result));
`;

test("a symbol that is only a property key of a live object stays alive", async () => {
  using dir = tempDir("symbol-property-key", { "fixture.mjs": fixture });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    "transition full": 0,
    "transition eden": 0,
    "dictionary full": 0,
    "dictionary eden": 0,
    "old dictionary eden": 0,
    "old object eden": 0,
    "old dictionary full": 0,
    "prototype full": 0,
    "ephemeron cycle collected": true,
  });
  expect(exitCode).toBe(0);
});
