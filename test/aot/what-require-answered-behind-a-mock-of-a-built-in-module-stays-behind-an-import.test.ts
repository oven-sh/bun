import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// A mock that is made while nothing is loaded stores nothing: its factory waits for the first load. What the first require() behind it answers
// stays in the module object in require.cache: neither a require() of the name as it is spelled nor an import() of the module behind that changes it.
const steps: Record<string, (name: string) => string> = {
  // By a name that is spelled, and by one that the build does not know.
  r: name => `tell("r", require("${name}"));`,
  i: name => `tell("i", await import("${name}"));`,
  R: () => `tell("R", require(unknown()));`,
  I: () => `tell("I", await import(unknown()));`,
};

// A plain object, one that says it is an ES module, and one whose factory is async.
const mocks: Record<string, (name: string) => string> = {
  a: name => `mock.module("${name}", () => made);`,
  b: name =>
    `Object.assign(made, { __esModule: true, default: (known.default = { marker: "default" }) }); mock.module("${name}", () => made);`,
  p: name => `await mock.module("${name}", async () => made);`,
};

const testFileOf = (name: string, kind: string, order: string) => (id: string) => `
  import { mock, test } from "bun:test";
  ${sayOf(id)}
  function mocked() {}
  const known = {}, told = [];
  function what(value) {
    for (const key in known) if (known[key] === value) return key;
    return [Object.prototype.toString.call(value).slice(8, -1), Object.keys(value).length, value.marker, value.__esModule, Object.isExtensible(value)].join("/");
  }
  function tell(step, value) { told.push(step + "=" + what(value)); }
  const unknown = () => Buffer.from("${Buffer.from(name).toString("hex")}", "hex").toString();
  test("${id}", async () => {
    const made = (known.made = { marker: "made", mocked });
    ${mocks[kind](name)}
    ${[...order].map(step => steps[step](name)).join("\n    ")}
    say(told.join(" "));
  });`;

const shared = { "package.json": `{ "name": "p", "type": "module" }`, "tsconfig.json": "{}" };
const byName = casesOfOneRun("a-require-by-name-behind-a-mock", shared);
const besideDelete = casesOfOneRun("a-require-beside-a-delete-behind-a-mock", shared);

const ordersByName = "Rr RrR RiR Rir RiRR RiRir RIR riR iR RR iRiR".split(" ");

function casesIn(project: typeof byName, name: string, orders: string[]) {
  const cases = Object.keys(mocks).flatMap(kind => orders.map(order => ({ kind, order })));
  const ids = cases.map(({ kind, order }) => project.add(testFileOf(name, kind, order)));
  return (ran: Awaited<ReturnType<typeof project.ran>>) =>
    cases.map(
      ({ kind, order }, index) =>
        `${kind} ${order}: ${ran.get(ids[index])?.result} ${ran.get(ids[index])?.printed.trim()}`,
    );
}

// In none of these orders is anything loaded when the mock is made, so require() never answers the object that the factory made.
function expectAnswersOfPlainBun(plain: string[]) {
  expect(plain.filter(line => !line.includes(": pass "))).toEqual([]);
  expect(plain.filter(line => /[rR]=made\b/.test(line))).toEqual([]);
  expect(plain.filter(line => line.startsWith("b ") && !/ [rR]=default$/.test(line))).toEqual([]);
}

// One with code whose exports say `__esModule`, one with code, one of native code.
for (const name of ["bun:sqlite", "ws", "bun:jsc"]) {
  const toldByName = casesIn(byName, name, ordersByName);
  test(`what require() answers for "${name}" by a name that the build does not know stays its answer`, async () => {
    const plain = toldByName(await byName.ran());
    expectAnswersOfPlainBun(plain);
    expect(toldByName(await byName.ran(["--debug-aot"]))).toEqual(plain);
  });

  // The test file that takes the module out of require.cache is another one, and runs in a realm of its own.
  const toldBesideDelete = casesIn(besideDelete, name, ["rir", "rirr"]);
  besideDelete.add(
    id => `
  import { test } from "bun:test";
  test("${id}", () => {
    delete require.cache["${name}"];
  });`,
  );
  test(`require("${name}"), import(), require() beside a test file that says delete require.cache["${name}"]`, async () => {
    const plain = toldBesideDelete(await besideDelete.ran());
    expectAnswersOfPlainBun(plain);
    expect(toldBesideDelete(await besideDelete.ran(["--debug-aot"]))).toEqual(plain);
  });
}
