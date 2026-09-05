const counter = Symbol.for("bun.test.jest.requireActual.primitiveLoads");
globalThis[counter] = (globalThis[counter] ?? 0) + 1;
module.exports = globalThis[counter];
