// One instance for the three files of 30-mocks-left-at-file-end-{a,b,c}.mjs in a
// `bun test` process.
import { mock } from "node:test";

const withRun = () => ({
  run() {
    return "real";
  },
});

export const left = withRun();
export const stacked = withRun();
export const stackedProperty = { value: "real" };
export const accessorProperty = {
  get value() {
    return "real";
  },
};
export const getterAndSetter = {
  get value() {
    return "real";
  },
  set value(value) {
    this.stored = value;
  },
};
export const setterOnly = {
  set value(value) {
    this.stored = value;
  },
};
export const rootHook = withRun();
export const rootThenModule = withRun();
export const moduleThenRoot = withRun();

class Tool {
  run() {
    return "real";
  }
}
export const inherited = new Tool();

// The mock of an inherited method copies its attributes, so this one is not configurable.
const fixedPrototype = {};
Object.defineProperty(fixedPrototype, "run", {
  value() {
    return "real";
  },
  writable: true,
  enumerable: false,
  configurable: false,
});
export const inheritedFixed = Object.create(fixedPrototype);

export const changedByHand = withRun();
export const wrappedByNextFile = withRun();

// When the first file has set `madeInTrap.atFileEnd`, a write to `makesMockInTrap`
// makes a mock. The end of the file writes to it, to take its mock off.
export const madeInTrap = { ...withRun(), atFileEnd: false };
export const makesMockInTrap = new Proxy(withRun(), {
  defineProperty(target, key, descriptor) {
    if (madeInTrap.atFileEnd) mock.method(madeInTrap, "run", () => "mocked");
    return Reflect.defineProperty(target, key, descriptor);
  },
});

const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;

// What the files after the first one compare.
export function read() {
  getterAndSetter.value = "stored";
  setterOnly.value = "stored";
  return {
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
    inheritedFixed: inheritedFixed.run(),
    changedByHand: changedByHand.run(),
    wrappedByNextFile: wrappedByNextFile.run(),
    madeInTrap: [makesMockInTrap.run(), madeInTrap.run()],
    realTimers: [globalThis.setTimeout === realSetTimeout, globalThis.setInterval === realSetInterval],
  };
}

export const expected = {
  left: "real",
  stacked: "real",
  stackedProperty: "real",
  accessorProperty: "real",
  getterAndSetter: ["real", "stored"],
  setterOnly: "stored",
  rootHook: "real",
  rootThenModule: "real",
  moduleThenRoot: "real",
  inherited: "real",
  inheritedFixed: "real",
  changedByHand: "real",
  wrappedByNextFile: "real",
  madeInTrap: ["real", "real"],
  realTimers: [true, true],
};
