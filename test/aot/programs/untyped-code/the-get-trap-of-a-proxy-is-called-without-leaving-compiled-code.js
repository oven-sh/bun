// `proxy.name` where the handler is a plain object that has or inherits a `get` that is a value: the trap is called straight from compiled code; every other
// proxy is read the long way. What the trap sees and what is demanded of its answer is the same on both ways.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function counted() { return count("operationAOTGetByNameAndFillTable") > 0; }
function direct() { return count("read of a proxy:the trap is called from the stub"); }
function read(o) { return o.wanted; }
function call(o) { return o.wanted(); }
function measure(label, make, expected) {
  var seen = [];
  try { read(make(seen)); } catch (error) {}
  var before = direct(), answer;
  for (var i = 0; i < 100; i++) { try { answer = read(make(seen)); } catch (error) { answer = "threw " + error.constructor.name; } }
  console.log(label + ": " + String(answer) + " | the trap ran " + seen.length + " times | " + (!counted() || direct() - before === expected));
}
measure("a trap of its own", function (seen) { return new Proxy({}, { get(t, key, receiver) { seen.push(key); return typeof key + " " + key; } }); }, 100);
measure("one proxy read again and again", (function () { var made; return function (seen) { return made ||= new Proxy({}, { get(t, key) { seen.push(key); return seen.length > 0; } }); }; })(), 100);
measure("an arrow", function (seen) { return new Proxy({}, { get: (t, key) => { seen.push(key); return "arrow"; } }); }, 100);
measure("a bound function", function (seen) { return new Proxy({}, { get: function (list, t, key) { list.push(key); return "bound"; }.bind(null, seen) }); }, 100);
measure("a host function", function () { return new Proxy({ wanted: "of the target" }, { get: Reflect.get }); }, 100);
measure("a function as the target", function (seen) { return new Proxy(function () {}, { get(t, key) { seen.push(key); return typeof t; } }); }, 100);
measure("an array as the target", function (seen) { return new Proxy([1], { get(t, key) { seen.push(key); return t.length; } }); }, 100);
measure("a frozen target, absent", function (seen) { return new Proxy(Object.freeze({ other: 1 }), { get(t, key) { seen.push(key); return "made up"; } }); }, 100);
measure("a frozen target, the same", function (seen) { return new Proxy(Object.freeze({ wanted: 1 }), { get(t, key) { seen.push(key); return 1; } }); }, 100);
measure("a frozen target, another", function (seen) { return new Proxy(Object.freeze({ wanted: 1 }), { get(t, key) { seen.push(key); return 2; } }); }, 100);
measure("the trap throws", function (seen) { return new Proxy({}, { get(t, key) { seen.push(key); throw new RangeError("no"); } }); }, 100);
measure("the trap freezes the target", function (seen) { return new Proxy({ wanted: 1 }, { get(t, key) { seen.push(key); Object.freeze(t); return 2; } }); }, 100);
measure("no trap", function () { return new Proxy({ wanted: "passed on" }, {}); }, 0);
measure("the trap is undefined", function () { return new Proxy({ wanted: "passed on" }, { get: undefined }); }, 0);
measure("the trap is no function", function () { return new Proxy({}, { get: 1 }); }, 0);
measure("an inherited trap", function (seen) { return new Proxy({}, Object.create({ get(t, key) { seen.push(key); return "inherited"; } })); }, 100);
measure("a trap behind a getter", function (seen) { return new Proxy({}, { get get() { return function (t, key) { seen.push(key); return "behind a getter"; }; } }); }, 0);
measure("a handler of a class", function (seen) { class Handler { get(t, key) { seen.push(key); return "of a class"; } } return new Proxy({}, new Handler); }, 100);
measure("a proxy as the handler", function (seen) { return new Proxy({ wanted: "passed on" }, new Proxy({}, { get(t, key) { seen.push(key); return undefined; } })); }, 0);
measure("an array as the handler", function (seen) { var handler = []; handler.get = function (t, key) { seen.push(key); return "of an array"; }; return new Proxy({}, handler); }, 0);
measure("revoked", function () { var made = Proxy.revocable({}, { get() { return 1; } }); made.revoke(); return made.proxy; }, 0);
var calls = 0, callable = new Proxy({}, { get(t, key) { return function () { calls++; return this === callable; }; } });
var before = direct(), all = true;
for (var i = 0; i < 100; i++) all = call(callable) && all;
console.log("a method read through the trap:", calls, all, !counted() || direct() - before === 100);
var plain = { wanted: 1 };
before = direct();
for (var i = 0; i < 100; i++) read(plain);
console.log("a plain object:", direct() - before);
