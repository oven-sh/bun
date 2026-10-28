// What stands on the handler, the proxy or the target changes between two accesses at the same warm sites.
var mark = Symbol("mark");
function get(o) { return o.wanted; }
function getKey(o, k) { return o[k]; }
function has(o) { return "wanted" in o; }
function set(o, v) { "use strict"; o.wanted = v; return "stored"; }
function setSloppy(o, v) { o.wanted = v; return "stored"; }
function attempt(f) { try { var v = f(); return typeof v === "symbol" ? v.toString() : String(v); } catch (e) { return "threw " + e.constructor.name + ": " + e.message; } }
function all(o) { return [attempt(() => get(o)), attempt(() => getKey(o, "wanted")), attempt(() => getKey(o, mark)), attempt(() => getKey(o, 0)), attempt(() => has(o)), attempt(() => set(o, 1)), attempt(() => setSloppy(o, 2))].join(" | "); }
var warm = new Proxy({}, { get() { return 1; }, has() { return true; }, set() { return true; } });
for (var i = 0; i < 300; i++) all(warm);
var steps = [
  ["traps as written", function (s) {}],
  ["replaced", function (s) { s.handler.get = function () { return "second"; }; s.handler.has = function () { return false; }; s.handler.set = function () { return false; }; }],
  ["replaced by arrows", function (s) { s.handler.get = () => "arrow"; s.handler.has = () => 1; s.handler.set = () => ""; }],
  ["deleted", function (s) { delete s.handler.get; delete s.handler.has; delete s.handler.set; }],
  ["inherited now", function (s) { Object.setPrototypeOf(s.handler, { get() { return "from above"; }, has() { return true; }, set() { return true; } }); }],
  ["what is above replaced", function (s) { Object.getPrototypeOf(s.handler).get = function () { return "above, second"; }; }],
  ["above gone", function (s) { Object.setPrototypeOf(s.handler, null); }],
  ["numbers", function (s) { s.handler.get = 1; s.handler.has = 2; s.handler.set = 3; }],
  ["undefined", function (s) { s.handler.get = s.handler.has = s.handler.set = undefined; }],
  ["getters", function (s) { var n = 0; for (let name of ["get", "has", "set"]) Object.defineProperty(s.handler, name, { get() { n++; return function () { return name + n; }; }, configurable: true }); }],
  ["values again", function (s) { for (let name of ["get", "has", "set"]) Object.defineProperty(s.handler, name, { value: function () { return true; }, configurable: true, writable: true }); }],
  ["many more names on the handler", function (s) { for (var i = 0; i < 80; i++) s.handler["n" + i] = i; }],
  ["the target gets the name", function (s) { s.target.wanted = "of the target"; }],
  ["the target's name is fixed", function (s) { Object.defineProperty(s.target, "wanted", { value: "fixed", writable: false, configurable: false }); }],
  ["the trap agrees", function (s) { s.handler.get = function (t, k) { return t[k]; }; s.handler.has = function (t, k) { return k in t; }; s.handler.set = function (t, k, v) { return false; }; }],
  ["the target takes no more", function (s) { Object.preventExtensions(s.target); s.handler.has = function () { return false; }; }],
  ["the handler is frozen", function (s) { Object.freeze(s.handler); }],
  ["revoked", function (s) { s.revoke(); }],
];
for (var makeTarget of [() => ({}), () => ({ a: 1, b: 2 }), () => [], () => function () {}, () => Object.create({ wanted: "above the target" }), () => new (class { x = 1; })]) {
  for (var makeHandler of [() => ({ get() { return "first"; }, has() { return true; }, set() { return true; } }), () => new (class { get() { return "first"; } has() { return true; } set() { return true; } }), () => Object.assign(Object.create(null), { get() { return "first"; }, has() { return true; }, set() { return true; } })]) {
    var target = makeTarget(), handler = makeHandler(), made = Proxy.revocable(target, handler);
    var state = { target, handler, revoke: made.revoke };
    var below = Object.create(made.proxy), around = new Proxy(made.proxy, {});
    for (var [label, step] of steps) {
      var moved = attempt(() => { step(state); return "ok"; });
      console.log(label + " (" + moved + "): " + all(made.proxy) + " || " + all(made.proxy));
      console.log("  below: " + all(below) + " || around: " + all(around));
      below = Object.create(made.proxy);
    }
  }
}
// A trap that changes the handler, revokes, or reads through the same site while it runs.
var order = [];
var self = Proxy.revocable({ wanted: 1 }, { get(t, k) { order.push("first"); this.get = function () { order.push("second"); return 2; }; return 1; } });
console.log(get(self.proxy), get(self.proxy), get(self.proxy), order.join());
var deep = 0, nested = new Proxy({}, { get(t, k, r) { return deep++ < 3 ? get(r) + 1 : 0; }, has(t, k) { return deep-- > 0 ? has(nested) : false; }, set(t, k, v, r) { return v > 0 ? (set(r, v - 1), true) : true; } });
console.log(get(nested), has(nested), set(nested, 3));
var gone = Proxy.revocable({ wanted: 1 }, { get(t, k) { gone.revoke(); return t[k]; }, has(t, k) { gone.revoke(); return true; }, set() { gone.revoke(); return true; } });
console.log(attempt(() => get(gone.proxy)), attempt(() => get(gone.proxy)), attempt(() => has(gone.proxy)), attempt(() => set(gone.proxy, 1)));
for (var overflow of [(p) => get(p), (p) => has(p), (p) => set(p, 1)]) { var endless = new Proxy({}, { get(t, k, r) { return r[k]; }, has(t, k) { return k in endless; }, set(t, k, v, r) { r[k] = v; return true; } }); console.log(attempt(() => overflow(endless)).slice(0, 40)); }
var chain = {}; for (var i = 0; i < 200; i++) chain = new Proxy(chain, i & 1 ? {} : { get(t, k, r) { return t[k]; }, has(t, k) { return k in t; }, set(t, k, v) { t[k] = v; return true; } });
console.log(attempt(() => set(chain, 9)), attempt(() => get(chain)), attempt(() => has(chain)));
