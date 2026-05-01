var testFailed = false;
const invariant = () => {
  testFailed = true;
};
var $$m = arg => {
  var module = { exports: {} },
    exports = module.exports;
  return arg(module, exports);
};
var size = 100,
  ttl = 3600;

export var $f332019d = $$m(
  {
    "relay-runtime/lib/network/RelayQueryResponseCache.js": (module, exports) => {
      var RelayQueryResponseCache = function () {
        var foo = function RelayQueryResponseCache(_ref) {
          var size = _ref.size,
            ttl = _ref.ttl;
          !(size > 0)
            ? process.env.NODE_ENV !== "production"
              ? invariant(false, "RelayQueryResponseCache: Expected the max cache size to be > 0, got " + "`%s`.", size)
              : invariant(false)
            : void 0;
          !(ttl > 0)
            ? process.env.NODE_ENV !== "production"
              ? invariant(false, "RelayQueryResponseCache: Expected the max ttl to be > 0, got `%s`.", ttl)
              : invariant(false)
            : void 0;
        };
        foo({ size: 100, ttl: 3600 });
      };
      RelayQueryResponseCache();
    },
  }["relay-runtime/lib/network/RelayQueryResponseCache.js"],
);

export function test() {
  var foo = () => result;
  //   $f332019d;

  if (testFailed) throw new Error("invariant should not be called");
  return testDone(import.meta.url);
}
