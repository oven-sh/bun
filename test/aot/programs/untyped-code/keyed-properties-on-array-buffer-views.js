// A typed array or a DataView that is given properties under computed keys keeps its ArrayBuffer, however often the storing code has run before.
function grow(o, count) { for (let i = 0; i < count; i++) o["many" + i] = i; }
function growBySymbols(o, symbols) { for (const symbol of symbols) o[symbol] = 1; }
function name(o) { o.a = 1; o.b = 2; o.c = 3; o.d = 4; o.e = 5; o.f = 6; o.g = 7; o.h = 8; o.i = 9; }
const symbols = Array.from({ length: 20 }, (_, i) => Symbol("s" + i));
const kinds = [
  ["Uint8Array over a buffer", backing => new Uint8Array(backing)],
  ["Float64Array over a buffer", backing => new Float64Array(backing)],
  ["a part of a buffer", backing => new Uint8Array(backing, 8, 4)],
  ["DataView", backing => new DataView(backing)],
];
const wrong = [];
for (const [kind, make] of kinds) {
  for (let count = 1; count <= 80; count++) {
    for (let round = 0; round < 3; round++) {
      const backing = new ArrayBuffer(16);
      new Uint8Array(backing)[8] = count;
      const view = make(backing);
      grow(view, count);
      let said;
      try { said = view.buffer === backing && new Uint8Array(view.buffer)[8] === count && view["many" + (count - 1)] === count - 1 && Object.keys(view).filter(key => key.startsWith("many")).length === count ? "" : "another answer"; } catch (e) { said = e.name + ": " + e.message; }
      if (said) wrong.push(kind + " " + count + " " + round + " " + said);
    }
  }
  console.log(kind, wrong.length, wrong.slice(0, 3).join(" | "));
}
for (let round = 0; round < 4; round++) {
  const small = new Uint8Array(4); small[1] = 7;
  const own = small.buffer;
  grow(small, 9);
  const large = new Uint8Array(100000); large[1] = 8;
  const ofLarge = large.buffer;
  grow(large, 9);
  const late = new Uint8Array(4); late[1] = 9;
  grow(late, 9);
  const bySymbols = new Uint8Array(new ArrayBuffer(8));
  const ofSymbols = bySymbols.buffer;
  growBySymbols(bySymbols, symbols);
  const byNames = new Uint8Array(new ArrayBuffer(8));
  const ofNames = byNames.buffer;
  name(byNames);
  console.log(round, small.buffer === own, new Uint8Array(small.buffer)[1], large.buffer === ofLarge, new Uint8Array(large.buffer)[1], new Uint8Array(late.buffer)[1], late.buffer === late.buffer, bySymbols.buffer === ofSymbols, Object.getOwnPropertySymbols(bySymbols).length, byNames.buffer === ofNames, byNames.i);
}
