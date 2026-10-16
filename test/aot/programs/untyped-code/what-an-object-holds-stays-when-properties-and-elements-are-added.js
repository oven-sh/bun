// Properties and elements added to the same objects by turns. Twenty properties are added to objects of 36 kinds in eleven ways (fields with written names, computed names and symbols, private fields and
// methods, stores), at code that has done it before; an element is stored ahead of the first addition, or elements are stored between the additions (ahead of the fourth, seventh, eighth and eleventh): an integer, one
// behind a hole, a double, an object, one far out, five in a row, one that is read-only, a length of zero, a push. The objects are made six in a row, side by side, and all six are looked at when all six are done:
// a write that misses its object lands in a neighbour. What is printed is a sum over what every element, every property and the object itself say; plain Bun's is what is expected.
var part = 0, parts = 1;
var current = null, between = null;
function step(i) { if (between && (i === 3 || i === 6 || i === 7 || i === 10)) between(current, i); return i; }
class Stamp { constructor(o) { return o; } }
var texts = [], symbols = [];
for (var i = 0; i < 20; i++) { texts.push("key" + i); symbols.push(Symbol("s" + i)); }
class ByName extends Stamp { a = step(0); b = step(1); c = step(2); d = step(3); e = step(4); f = step(5); g = step(6); h = step(7); i = step(8); j = step(9); k = step(10); l = step(11); m = step(12); n = step(13); o = step(14); p = step(15); q = step(16); r = step(17); s = step(18); t = step(19); }
class ByText extends Stamp { [texts[0]] = step(0); [texts[1]] = step(1); [texts[2]] = step(2); [texts[3]] = step(3); [texts[4]] = step(4); [texts[5]] = step(5); [texts[6]] = step(6); [texts[7]] = step(7); [texts[8]] = step(8); [texts[9]] = step(9); [texts[10]] = step(10); [texts[11]] = step(11); [texts[12]] = step(12); [texts[13]] = step(13); [texts[14]] = step(14); [texts[15]] = step(15); [texts[16]] = step(16); [texts[17]] = step(17); [texts[18]] = step(18); [texts[19]] = step(19); }
class BySymbol extends Stamp { [symbols[0]] = step(0); [symbols[1]] = step(1); [symbols[2]] = step(2); [symbols[3]] = step(3); [symbols[4]] = step(4); [symbols[5]] = step(5); [symbols[6]] = step(6); [symbols[7]] = step(7); [symbols[8]] = step(8); [symbols[9]] = step(9); [symbols[10]] = step(10); [symbols[11]] = step(11); [symbols[12]] = step(12); [symbols[13]] = step(13); [symbols[14]] = step(14); [symbols[15]] = step(15); [symbols[16]] = step(16); [symbols[17]] = step(17); [symbols[18]] = step(18); [symbols[19]] = step(19); }
class Private extends Stamp { #a = step(0); #b = step(1); #c = step(2); #d = step(3); #e = step(4); #f = step(5); #g = step(6); #h = step(7); #i = step(8); #j = step(9); #k = step(10); #l = step(11); #m = step(12); #n = step(13); #o = step(14); #p = step(15); #q = step(16); #r = step(17); #s = step(18); #t = step(19); static read(o) { return [o.#a, o.#b, o.#c, o.#d, o.#e, o.#f, o.#g, o.#h, o.#i, o.#j, o.#k, o.#l, o.#m, o.#n, o.#o, o.#p, o.#q, o.#r, o.#s, o.#t]; } }
class PrivateMethods extends Stamp { #a() { return 0; } #b() { return 1; } #c() { return 2; } #d() { return 3; } #e() { return 4; } #f() { return 5; } #g() { return 6; } #h() { return 7; } #i() { return 8; } static read(o) { return [o.#a(), o.#b(), o.#c(), o.#d(), o.#e(), o.#f(), o.#g(), o.#h(), o.#i()]; } }
class Mixed extends Stamp { #p = step(0); a = step(1); [texts[2]] = step(2); #m() { return 3; } [symbols[4]] = step(4); #q = step(5); g = step(6); [texts[7]] = step(7); #r = step(8); j = step(9); [symbols[10]] = step(10); static read(o) { return [o.#p, o.a, o[texts[2]], o.#m(), o[symbols[4]], o.#q, o.g, o[texts[7]], o.#r, o.j, o[symbols[10]]]; } }
function storeNames(o) { o.a = step(0); o.b = step(1); o.c = step(2); o.d = step(3); o.e = step(4); o.f = step(5); o.g = step(6); o.h = step(7); o.i = step(8); o.j = step(9); o.k = step(10); o.l = step(11); o.m = step(12); o.n = step(13); o.o = step(14); o.p = step(15); o.q = step(16); o.r = step(17); o.s = step(18); o.t = step(19); return o; }
function storeKeys(o, keys) { for (var i = 0; i < keys.length; i++) o[keys[i]] = step(i); return o; }
function upTo(n) { var list = []; for (var i = 0; i < n; i++) list.push(i); return list.join(); }
var ways = {
  "fields by name": function (o) { new ByName(o); return [o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.h, o.i, o.j, o.k, o.l, o.m, o.n, o.o, o.p, o.q, o.r, o.s, o.t].join() === upTo(20); },
  "fields by text": function (o) { new ByText(o); return texts.map(function (k) { return o[k]; }).join() === upTo(20); },
  "fields by symbol": function (o) { new BySymbol(o); return symbols.map(function (k) { return o[k]; }).join() === upTo(20); },
  "private fields": function (o) { new Private(o); return Private.read(o).join() === upTo(20); },
  "private methods": function (o) { new PrivateMethods(o); return PrivateMethods.read(o).join() === upTo(9); },
  "of every kind by turns": function (o) { new Mixed(o); return Mixed.read(o).join() === upTo(11); },
  "stores by name": function (o) { storeNames(o); return [o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.h, o.i, o.j, o.k, o.l, o.m, o.n, o.o, o.p, o.q, o.r, o.s, o.t].join() === upTo(20); },
  "stores by text": function (o) { storeKeys(o, texts); return texts.map(function (k) { return o[k]; }).join() === upTo(20); },
  "stores by symbol": function (o) { storeKeys(o, symbols); return symbols.map(function (k) { return o[k]; }).join() === upTo(20); },
  "private fields, then fields by name": function (o) { new Private(o); new ByName(o); return Private.read(o).join() === upTo(20) && o.t === 19; },
  "stores by name, then fields by symbol": function (o) { storeNames(o); new BySymbol(o); return o.a === 0 && o.t === 19 && o[symbols[19]] === 19; },
};
class Heir extends Array {}
class MapHeir extends Map {}
class SetHeir extends Set {}
class PromiseHeir extends Promise {}
function view(make) { return function (round) { var backing = new ArrayBuffer(32); new Uint8Array(backing)[8] = round + 1; var o = make(backing); return [o, function () { return o.buffer === backing && new Uint8Array(o.buffer)[8] === round + 1 && o.byteLength > 0; }]; }; }
function list(make) { return function (round) { var o = make(round), before = Array.prototype.join.call(o), length = o.length; return [o, function () { return Array.prototype.join.call(o) === before && o.length === length && Array.isArray(o); }]; }; }
var kinds = {
  "Uint8Array over a buffer": view(function (b) { return new Uint8Array(b); }),
  "Float64Array over a buffer": view(function (b) { return new Float64Array(b); }),
  "a part of a buffer": view(function (b) { return new Uint8Array(b, 8, 4); }),
  "DataView": view(function (b) { return new DataView(b); }),
  "BigInt64Array over a buffer": view(function (b) { return new BigInt64Array(b); }),
  "a small typed array, its buffer asked for first": function (round) { var o = new Uint8Array(4); o[1] = round + 1; var own = o.buffer; return [o, function () { return o.buffer === own && new Uint8Array(o.buffer)[1] === round + 1; }]; },
  "a small typed array, its buffer asked for last": function (round) { var o = new Uint8Array(4); o[1] = round + 1; return [o, function () { return o[1] === round + 1 && new Uint8Array(o.buffer)[1] === round + 1 && o.buffer === o.buffer; }]; },
  "a large typed array": function (round) { var o = new Uint8Array(100000); o[99999] = round + 1; var own = o.buffer; return [o, function () { return o.buffer === own && o[99999] === round + 1; }]; },
  "an array of integers": list(function (round) { return [1, 2, round]; }),
  "an array of doubles": list(function (round) { return [1.5, 2.5, round + 0.5]; }),
  "an array of values": list(function (round) { return ["a", null, round]; }),
  "an array literal of constants": list(function () { return [1, 2, 3]; }),
  "an empty array": list(function () { return []; }),
  "an array with holes": list(function (round) { var o = [1, 2, 3, round]; delete o[1]; return o; }),
  "a sparse array": list(function (round) { var o = [round]; o[3000] = "far"; return o; }),
  "an array that was pushed to": list(function (round) { var o = []; for (var i = 0; i < 40; i++) o.push(i + round); return o; }),
  "an array that was shifted": list(function (round) { var o = [0, 1, 2, 3, 4, 5, 6, 7, round]; o.shift(); o.shift(); o.unshift(9); return o; }),
  "an heir of Array": list(function (round) { return new Heir(1, 2, round); }),
  "a function": function (round) { var o = function named() { return round; }; return [o, function () { return o() === round && o.name === "named" && o.length === 0 && typeof o.prototype === "object"; }]; },
  "an arrow": function (round) { var o = () => round; return [o, function () { return o() === round && o.name === "o"; }]; },
  "a bound function": function (round) { var o = function (x) { return x; }.bind(null, round); return [o, function () { return o() === round; }]; },
  "a class": function (round) { var o = class Named { static held = round; }; return [o, function () { return o.held === round && o.name === "Named" && new o instanceof o; }]; },
  "a Map": function (round) { var o = new Map([[1, round]]); return [o, function () { return o.get(1) === round && o.size === 1; }]; },
  "an heir of Map": function (round) { var o = new MapHeir([[1, round]]); return [o, function () { return o.get(1) === round && o.size === 1; }]; },
  "an heir of Set": function (round) { var o = new SetHeir([round]); return [o, function () { return o.has(round) && o.size === 1; }]; },
  "an heir of Promise": function (round) { var o = new PromiseHeir(function (resolve) { resolve(round); }); return [o, function () { return o instanceof Promise && typeof o.then === "function"; }]; },
  "a Date": function (round) { var o = new Date(round); return [o, function () { return o.getTime() === round; }]; },
  "a RegExp": function (round) { var o = /a/g; o.lastIndex = round; return [o, function () { return o.lastIndex === round && o.source === "a"; }]; },
  "an Error": function (round) { var o = new Error("message " + round); return [o, function () { return o.message === "message " + round && typeof o.stack === "string"; }]; },
  "an ArrayBuffer": function (round) { var o = new ArrayBuffer(round + 1); return [o, function () { return o.byteLength === round + 1; }]; },
  "a String object": function (round) { var o = new String("ab" + round); return [o, function () { return o.length === 3 && o[2] === String(round); }]; },
  "arguments": function (round) { var o = (function () { return arguments; })(round, 2); return [o, function () { return o[0] === round && o.length === 2; }]; },
  "a plain object": function (round) { var o = { held: round }; return [o, function () { return o.held === round; }]; },
  "an object with elements": function (round) { var o = { held: round }; o[0] = "zero"; o[1] = round; return [o, function () { return o.held === round && o[0] === "zero" && o[1] === round; }]; },
  "an object with no prototype": function (round) { var o = Object.create(null); o.held = round; return [o, function () { return o.held === round; }]; },
  "an object with many properties": function (round) { var o = {}; for (var i = 0; i < 30; i++) o["held" + i] = i + round; return [o, function () { return o.held0 === round && o.held29 === 29 + round; }]; },
};
var elements = {
  "an integer": function (o, n) { o[n] = 7 + n; },
  "behind a hole": function (o, n) { o[7 + n] = n; },
  "a double": function (o, n) { o[3 + n] = 0.5 + n; },
  "an object": function (o, n) { o[3 + n] = { n: n }; },
  "far out": function (o, n) { o[100000 + n] = 1; },
  "five in a row": function (o, n) { for (var k = 0; k < 5; k++) o[n + k] = k; },
  "read-only": function (o, n) { Object.defineProperty(o, 2 + n, { value: n, writable: false, enumerable: true, configurable: true }); },
  "a length of zero": function (o, n) { if (Array.isArray(o)) o.length = 0; else o[n] = "x"; },
  "a push": function (o, n) { if (Array.isArray(o)) o.push(n, n + 1); else o[1] = n; },
};
var places = [];
for (var i = 0; i <= 20; i++) places.push(i);
for (var i = 99999; i <= 100011; i++) places.push(i);
function show(x) { return x !== null && typeof x === "object" ? "{" + x.n + "}" : String(x); }
function look(o) {
  var said = "";
  for (var i = 0; i < places.length; i++) said += places[i] in o ? show(o[places[i]]) + "," : "-";
  return said + ("length" in o ? o.length : "");
}
function careful(f, o, n) { try { f(o, n); return ""; } catch (error) { return error.constructor.name; } }
function sum(text, from) { for (var i = 0; i < text.length; i++) from = (Math.imul(from, 31) + text.charCodeAt(i)) | 0; return from; }
var number = 0;
for (var kind in kinds) {
  if (number++ % parts !== part) continue;
  var sums = [];
  for (var element in elements) {
    for (var isFirst = 0; isFirst < 2; isFirst++) {
      var total = 0;
      for (var way in ways) {
        var row = [], said = [];
        for (var k = 0; k < 6; k++) row.push(kinds[kind](k));
        for (var k = 0; k < 6; k++) {
          current = row[k][0];
          var thrown = isFirst ? careful(elements[element], current, 0) : "";
          between = isFirst ? null : function (o, n) { thrown += careful(elements[element], o, n); };
          var reads;
          try { reads = ways[way](current); } catch (error) { reads = error.constructor.name; }
          between = null;
          said.push(thrown + reads);
        }
        for (var k = 0; k < 6; k++) total = sum(said[k] + look(row[k][0]) + row[k][1](), total);
      }
      sums.push(total);
    }
  }
  console.log(kind + ": " + sums.join(" "));
}
