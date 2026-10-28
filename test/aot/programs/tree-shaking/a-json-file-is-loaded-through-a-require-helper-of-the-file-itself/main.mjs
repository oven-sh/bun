var __require = /* @__PURE__ */ (x =>
  typeof require !== "undefined"
    ? require
    : typeof Proxy !== "undefined"
      ? new Proxy(x, { get: (a, b) => (typeof require !== "undefined" ? require : a)[b] })
      : x)(function (x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
console.log(__require("./data.json").version);
const { nested } = __require("./data.json");
console.log(nested.port);
