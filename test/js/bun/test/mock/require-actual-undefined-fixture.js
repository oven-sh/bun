const counter = Symbol.for("bun.test.jest.requireActual.undefinedLoads");
globalThis[counter] = (globalThis[counter] ?? 0) + 1;
module.exports = undefined;
