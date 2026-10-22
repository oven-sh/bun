function lazy(name, load) {
  Object.defineProperty(exports, name, { enumerable: true, configurable: true, get: load });
}

lazy("first", () => require("./first.ts").first);
lazy("second", function () { return require("./second.ts").default; });
