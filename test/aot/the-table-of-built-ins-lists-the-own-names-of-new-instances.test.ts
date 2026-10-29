// The compiler takes a read of a name that a new instance of a built-in class does not have for `undefined`. It knows the names from the table of built-ins: the columns
// `namesDefinedOnNewInstances` of the class and of the classes above it, and the members under `instance`. Here each class that can be constructed from the global object is
// constructed, in a process of its own, and the own names of the instance are held against the table.
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { findBuiltinTable } from "./harness/builtin-table";
import { test } from "./supported";

const title = "the table of built-ins lists the own names of a new instance of every class";
const table = findBuiltinTable(bunExe());

// What a function has besides `length` and `name` follows from its kind, which the compiler knows for a function of the program; it follows no function made from text.
const classesOfFunctions = ["Function", "WebAssembly.Suspending"];

const script = `
const table = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const classes = new Map(table.classes.map(entry => [entry.token, entry]));
const entries = new Map(table.entries.map(entry => [entry.token, entry]));
const membersOfInstances = new Map();
for (const entry of table.entries) {
  if (!entry.flags.includes("IsOwnPropertyOfInstances") || !entry.holder) continue;
  if (!membersOfInstances.has(entry.holder)) membersOfInstances.set(entry.holder, []);
  membersOfInstances.get(entry.holder).push(entry.name);
}
function listedFor(builtinClass) {
  const names = new Set();
  for (let current = builtinClass; current; current = classes.get(current.parent)) {
    for (const name of current.namesDefinedOnNewInstances ?? []) names.add(name);
    for (const name of membersOfInstances.get(current.prototype) ?? []) names.add(name);
  }
  return names;
}
function reach(path) {
  let value = globalThis;
  for (const part of path.split(".")) value = value?.[part];
  return value;
}
const operands = [[], ["x"], [1], [{}], ["x", {}], [new ArrayBuffer(8)], [() => {}], [[]], ["http://a.b/c"], [["x"], "n"], [{}, {}], ["a", "b"], [new Uint8Array(8)], ["sha1"], ["*"]];
const found = { made: 0, notListed: [] };
for (const builtinClass of table.classes) {
  const path = entries.get(builtinClass.constructor)?.path;
  if (path === undefined || /^(%|native:|node:|bun:)/.test(path)) continue;
  const constructor = reach(path);
  if (typeof constructor !== "function") continue;
  let instance;
  for (const passed of operands) {
    try {
      instance = new constructor(...passed);
      break;
    } catch {}
  }
  if (Object(instance) !== instance) continue;
  found.made++;
  const listed = listedFor(builtinClass);
  const others = Object.getOwnPropertyNames(instance).filter(name => !/^\\d+$/.test(name) && !listed.has(name));
  if (others.length) found.notListed.push(path + ": " + others.join(" "));
}
console.log(JSON.stringify(found));
process.exit(0);
`;

test.skipIf(table === undefined)(title, () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", script, table!],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const found = JSON.parse(stdout.toString()) as { made: number; notListed: string[] };
  expect(found.notListed.filter(line => !classesOfFunctions.includes(line.slice(0, line.indexOf(":"))))).toEqual([]);
  expect(found.made).toBeGreaterThan(90);
  expect(exitCode).toBe(0);
});
