// Twenty properties added to a Buffer: by fields with written names, with computed names and with symbols, by private fields and private
// methods, and by stores: at code that has done it before. It keeps its ArrayBuffer, its place in it and its bytes, and every property
// reads back.
// Every value that is added is made by step(), which looks at what the object holds as it stands behind the additions so far.
var holds = null, lostAt = [];
function step(i) { if (holds && !holds()) lostAt.push(i); return i; }
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
function held(make) { return function (round) { var o = make(round), backing = o.buffer, offset = o.byteOffset, text = o.toString("hex"); return [o, function () { return o.buffer === backing && o.byteOffset === offset && o.toString("hex") === text && Buffer.isBuffer(o); }]; }; }
var kinds = {
  "Buffer.alloc": held(function (round) { var o = Buffer.alloc(8); o[1] = round + 1; return o; }),
  "Buffer.allocUnsafe": held(function (round) { var o = Buffer.allocUnsafe(8); o.fill(round + 1); return o; }),
  "Buffer.allocUnsafeSlow": held(function (round) { var o = Buffer.allocUnsafeSlow(8); o.fill(round + 1); return o; }),
  "Buffer.from a text": held(function (round) { return Buffer.from("text " + round); }),
  "Buffer.from an array": held(function (round) { return Buffer.from([1, 2, round]); }),
  "Buffer.from an ArrayBuffer": held(function (round) { var backing = new ArrayBuffer(16); new Uint8Array(backing)[4] = round + 1; return Buffer.from(backing, 4, 8); }),
  "a part of a Buffer": held(function (round) { var whole = Buffer.alloc(32); whole[9] = round + 1; return whole.subarray(8, 16); }),
  "a large Buffer": held(function (round) { var o = Buffer.alloc(100000); o[99999] = round + 1; return o.subarray(99990); }),
  "Buffer.concat": held(function (round) { return Buffer.concat([Buffer.from("a"), Buffer.from(String(round))]); }),
  "an empty Buffer": held(function () { return Buffer.alloc(0); }),
};
for (var kind in kinds) {
  var wrong = [];
  for (var way in ways) {
    for (var round = 0; round < 5; round++) {
      var said;
      try { var made = kinds[kind](round); holds = made[1]; lostAt = []; said = !ways[way](made[0]) ? "a property reads back wrong" : !made[1]() ? "it lost what it held" : lostAt.length ? "it had lost what it held ahead of addition " + lostAt.join() : ""; } catch (error) { said = "threw " + error.constructor.name + ": " + error.message; }
      holds = null;
      if (said) wrong.push(way + " " + round + ": " + said);
    }
  }
  console.log(kind + ": " + (wrong.length ? wrong.length + " wrong: " + wrong.slice(0, 4).join(" | ") : "as it was"));
}
