// node-test.test.ts runs this file, then 30-mocks-left-at-file-end-b.mjs and
// -c.mjs, in one `bun test` process. This file leaves module-level mocks, and
// mocks of the `t.mock` of a file-level hook, on properties of a module that
// the next files import too. It calls no restore and no reset.
//
// Node.js runs each file in a new process, so there the next file gets every
// real value. These three files pass with `node --test` too. `bun test` runs
// the files in one process and takes the mocks of a file off when the file
// ends, the newest first.
import assert from "node:assert";
import { before, beforeEach, mock, test } from "node:test";
import {
  accessorProperty,
  changedByHand,
  getterAndSetter,
  inherited,
  inheritedFixed,
  left,
  moduleThenRoot,
  rootHook,
  rootThenModule,
  setterOnly,
  stacked,
  stackedProperty,
  wrappedByNextFile,
} from "./30-mocks-left-at-file-end-shared.mjs";

// Older than the mock that the hook below makes of the same method.
mock.method(moduleThenRoot, "run", () => "module-level");

before(t => {
  t.mock.method(rootHook, "run", () => "root");
  t.mock.method(rootThenModule, "run", () => "root");
  t.mock.method(moduleThenRoot, "run", () => "root");
  t.mock.timers.enable({ apis: ["setInterval"] });
});

// One more mock of the same method for each test of this file.
beforeEach(() => {
  mock.method(stacked, "run", () => "mocked");
});

test("leaves mocks on their properties", () => {
  mock.method(left, "run", () => "mocked");
  mock.method(rootThenModule, "run", () => "module-level");
  mock.property(stackedProperty, "value", "first");
  mock.property(stackedProperty, "value", "second");
  mock.property(accessorProperty, "value", "mocked");
  mock.getter(getterAndSetter, "value", () => "mocked");
  mock.setter(getterAndSetter, "value", () => {});
  mock.setter(setterOnly, "value", () => {});
  mock.method(inherited, "run", () => "mocked");
  mock.method(inheritedFixed, "run", () => "mocked");
  mock.method(wrappedByNextFile, "run", () => "mocked");

  getterAndSetter.value = "not stored";
  setterOnly.value = "not stored";
  assert.deepStrictEqual(
    {
      left: left.run(),
      stacked: stacked.run(),
      stackedProperty: stackedProperty.value,
      accessorProperty: accessorProperty.value,
      getterAndSetter: [getterAndSetter.value, getterAndSetter.stored],
      setterOnly: setterOnly.stored,
      rootHook: rootHook.run(),
      rootThenModule: rootThenModule.run(),
      moduleThenRoot: moduleThenRoot.run(),
      inherited: inherited.run(),
      inheritedFixed: [inheritedFixed.run(), Object.getOwnPropertyDescriptor(inheritedFixed, "run").configurable],
      wrappedByNextFile: wrappedByNextFile.run(),
    },
    {
      left: "mocked",
      stacked: "mocked",
      stackedProperty: "second",
      accessorProperty: "mocked",
      getterAndSetter: ["mocked", undefined],
      setterOnly: undefined,
      rootHook: "root",
      rootThenModule: "module-level",
      moduleThenRoot: "root",
      inherited: "mocked",
      inheritedFixed: ["mocked", false],
      wrappedByNextFile: "mocked",
    },
  );
});

test("puts another function on a mocked method by hand", () => {
  mock.method(changedByHand, "run", () => "mocked");
  changedByHand.run = () => "by hand";

  assert.strictEqual(stacked.run(), "mocked");
});

// The last test of the file: from here to the next file setTimeout is a fake.
test("leaves mock.timers enabled", () => {
  const { setTimeout: realSetTimeout, setInterval: fakeSetInterval } = globalThis;
  mock.timers.enable({ apis: ["setTimeout"] });
  assert.notStrictEqual(globalThis.setTimeout, realSetTimeout);
  assert.strictEqual(globalThis.setInterval, fakeSetInterval);
});
