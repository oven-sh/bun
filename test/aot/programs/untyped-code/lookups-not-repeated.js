// A name that was looked up once for a shape is not looked up again: the second read, store or call by that name on an object of that shape
// is served by what the first one left behind, whatever kind of place the name has. All objects of a kind have one shape, and one of them is
// read, called or stored to before the count starts, so every lookup in the runtime that is counted repeats a pair of shape and name; under
// plain Bun there is nothing to count.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
function readLookups() { return count("operationAOTGetByIdAndCache"); }
function storeLookups() { return count("operationAOTPutByIdAndCache"); }
function read(o) { return o.wanted; }
function call(o) { return o.method(); }
function store(o, value) { o.wanted = value; }
function far(make) { var o = {}; for (var i = 0; i < 40; i++) o["filler" + i] = i; return make(o); }
class Base { get wanted() { return "from a getter of a class"; } set wanted(value) {} method() { return "a method of a class"; } }
class Derived extends Base {}
var proto = { wanted: "inherited", method() { return "an inherited method"; } };
var middle = Object.create(proto);
var farProto = far(function (o) { o.wanted = "inherited out of line"; o.method = function () { return "an inherited method out of line"; }; return o; });
var kinds = {
  "in the object": function () { return { wanted: 1, method() { return "own"; } }; },
  "out of line": function () { return far(function (o) { o.wanted = 2; o.method = function () { return "own out of line"; }; return o; }); },
  "inherited": function () { return Object.create(proto); },
  "inherited out of line": function () { return Object.create(farProto); },
  "inherited twice": function () { return Object.create(middle); },
  "a getter of its own": function () { return { get wanted() { return "from a getter"; }, set wanted(value) {}, method() { return "own"; } }; },
  "a class": function () { return new Base; },
  "a derived class": function () { return new Derived; },
  "an array": function () { var o = [1, 2]; o.wanted = 3; o.method = function () { return "of an array"; }; return o; },
  "a function": function () { function o() {} o.wanted = 4; o.method = function () { return "of a function"; }; return o; },
  "no prototype": function () { var o = Object.create(null); o.wanted = 5; o.method = function () { return "without a prototype"; }; return o; },
  "frozen": function () { return Object.freeze({ wanted: 6, method() { return "frozen"; } }); },
};
for (var label in kinds) {
  var make = kinds[label], answers = [];
  read(make()); call(make());
  var before = readLookups();
  for (var i = 0; i < 200; i++) { var o = make(); answers[0] = read(o); answers[1] = call(o); }
  var again = readLookups() - before;
  console.log(label + ": " + answers.join(" | ") + ": looked up again " + again);
}
var emptyMiddle = Object.create({ other: 1 });
var absent = { "absent": function () { return { other: 1 }; }, "absent under a chain": function () { return Object.create(emptyMiddle); }, "absent with no prototype": function () { return Object.create(null); }, "absent of an array": function () { return []; } };
for (var label in absent) {
  var make = absent[label], answer;
  read(make());
  var before = readLookups();
  for (var i = 0; i < 200; i++) answer = read(make());
  var again = readLookups() - before;
  console.log(label + ": " + answer + ": looked up again " + again);
}
var stored = { "replaced": function () { return { wanted: 0 }; }, "added": function () { return { other: 1 }; }, "added to an empty object": function () { return {}; }, "replaced out of line": function () { return far(function (o) { o.wanted = 0; return o; }); }, "a setter": function () { return new Base; } };
for (var label in stored) {
  var make = stored[label], last;
  store(make(), 0);
  var before = storeLookups();
  for (var i = 0; i < 200; i++) { last = make(); store(last, i); }
  var again = storeLookups() - before;
  console.log(label + ": " + last.wanted + ": looked up again " + again);
}
// What cannot be remembered is seen by the count.
var passing = new Proxy({ wanted: "passed on" }, {});
read(passing);
var before = readLookups();
for (var i = 0; i < 200; i++) answer = read(passing);
var again = readLookups() - before;
console.log("a proxy without a trap: " + answer + ": " + (again === 0 || again >= 199));
