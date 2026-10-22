// Each function is named once. It is reached through a Proxy that forwards, a Proxy whose trap answers with it, a getter, a setter that stores it, the arguments object, rest parameters, a spread call, a default value, bind with arguments, and a tagged template's values.
function a() { return "a forwarding proxy"; } function b() { return "a get trap"; } function c() { return "a getter"; } function d() { return "a setter"; }
function e() { return "the arguments object"; } function f() { return "rest parameters"; } function g() { return "a spread call"; } function h() { return "a default value"; }
function i() { return "bound as an argument"; } function j() { return "a value of a tagged template"; } function k() { return "an apply trap"; } function l() { return "a construct trap"; }
function m() { return "a lazy getter that replaces itself"; }

console.log(new Proxy({ run: a }, {}).run());
console.log(new Proxy({}, { get: () => b }).anything());
console.log({ get run() { return c; } }.run());
const holder = { set run(value) { this.stored = value; } };
holder.run = d;
console.log(holder.stored());
console.log((function () { return arguments[arguments.length - 1](); })(1, 2, e));
console.log(((...all) => all.at(-1)())(1, f));
console.log(((x, y) => y())(...[1, g]));
console.log(((run = h) => run())());
console.log((run => run()).bind(null, i)());
console.log(((strings, value) => value())`${j}`);
console.log(new Proxy(function () {}, { apply: () => k() })());
console.log(new (new Proxy(function () {}, { construct: () => ({ run: l }) }))().run());
const lazy = { get run() { Object.defineProperty(this, "run", { value: m }); return this.run; } };
console.log(lazy.run(), lazy.run());
