import {
__HMRClient as Bun
} from "http://localhost:8080/bun:wrap";
Bun.activate(false);
import {
__FastRefreshModule as FastHMR
} from "http://localhost:8080/bun:wrap";
import {
__FastRefreshRuntime as FastRefresh
} from "http://localhost:8080/bun:wrap";
import what from "http://localhost:8080/_auth.js";
import * as where from "http://localhost:8080/_auth.js";
var hmr = new FastHMR(1805832743, "export.js", FastRefresh), exports = hmr.exports;
(hmr._load = function() {
  var yoyoyo = "yoyoyo";
  function hey() {
    return true;
  }
  var foo = () => {
  };
  var bar = 100;
  var powerLevel = Symbol("9001");
  function test() {
    hey();
    foo();
    if (where.default !== "hi")
      throw new Error(`_auth import is incorrect.`);
    console.assert(powerLevel.description === "9001", "Symbol is not exported correctly");
    return testDone(import.meta.url);
  }
  hmr.exportAll({
    yoyoyo: () => yoyoyo,
    default: () => hey,
    foo: () => foo,
    bar: () => bar,
    powerLevel: () => powerLevel,
    what: () => what,
    when: () => what,
    whence: () => what,
    where: () => where,
    booop: () => bar,
    test: () => test
  });
})();
var $$hmr_yoyoyo = hmr.exports.yoyoyo, $$hmr_default = hmr.exports.default, $$hmr_foo = hmr.exports.foo, $$hmr_bar = hmr.exports.bar, $$hmr_powerLevel = hmr.exports.powerLevel, $$hmr_what = hmr.exports.what, $$hmr_when = hmr.exports.when, $$hmr_whence = hmr.exports.whence, $$hmr_where = hmr.exports.where, $$hmr_booop = hmr.exports.booop, $$hmr_test = hmr.exports.test;
hmr._update = function(exports) {
  $$hmr_yoyoyo = exports.yoyoyo;
  $$hmr_default = exports.default;
  $$hmr_foo = exports.foo;
  $$hmr_bar = exports.bar;
  $$hmr_powerLevel = exports.powerLevel;
  $$hmr_what = exports.what;
  $$hmr_when = exports.when;
  $$hmr_whence = exports.whence;
  $$hmr_where = exports.where;
  $$hmr_booop = exports.booop;
  $$hmr_test = exports.test;
};

export {
  $$hmr_yoyoyo as yoyoyo,
  $$hmr_default as default,
  $$hmr_foo as foo,
  $$hmr_bar as bar,
  $$hmr_powerLevel as powerLevel,
  $$hmr_what as what,
  $$hmr_when as when,
  $$hmr_whence as whence,
  $$hmr_where as where,
  $$hmr_booop as booop,
  $$hmr_test as test
};
export { default as auth } from "http://localhost:8080/_auth.js";
export { default as login } from "http://localhost:8080/_login.js";
export * from "http://localhost:8080/_bacon.js";
export {  } from "http://localhost:8080/_bacon.js";

//# sourceMappingURL=http://localhost:8080/export.js.map
