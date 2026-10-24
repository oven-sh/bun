// `size` is a getter of a class of the program, and of Map and Set as well. It is read by name on values that came back from evaluated text, so a read knows nothing about its receiver. Cut down from a row of the operations benchmark (getter_call, types erased) that failed to build.
const launder = new Function("v", "return v");
class WithGetter {
  constructor(n) { this.n = n | 0; }
  get size() { return this.n; }
}
const a = launder(new WithGetter(2)), b = launder(new WithGetter(3));
function read(o, r) {
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  return r;
}
let x = 0;
for (let i = 0; i < 1000; ++i) x = read((i & 1) === 0 ? a : b, x);
console.log(x, read(new Map([[1, 1]]), 0), read(new Set(), 0));

// As in the row: the text is put together while the program runs, the function that reads is too large to inline, and a name chosen while the program runs picks the loop.
const word = Date.now() > 0 ? "lit_zz" : "never";
const launderLate = new Function("v", "return v" + word.slice(word.length));
let g0 = word.length | 0, g1 = (g0 + 1) | 0, g2 = (g0 + 2) | 0, g3 = (g0 + 3) | 0, g4 = (g0 + 4) | 0;
const c = launderLate(new WithGetter(g0 - 4)), d = launderLate(new WithGetter(g0 - 3));
function readOften(o, r) {
  if (g4 > 1000000) { g1 = ((g2 + 3) ^ g3) | 0; g2 = ((g3 + 5) ^ g4) | 0; g3 = ((g4 + 7) ^ g1) | 0; g4 = ((g1 + 9) ^ g2) | 0; g1 = ((g2 + 11) ^ g3) | 0; g2 = ((g3 + 13) ^ g4) | 0; g3 = ((g4 + 15) ^ g1) | 0; g4 = ((g1 + 17) ^ g2) | 0; g1 = ((g2 + 19) ^ g3) | 0; g2 = ((g3 + 21) ^ g4) | 0; g3 = ((g4 + 23) ^ g1) | 0; g4 = ((g1 + 25) ^ g2) | 0; }
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  r = (r + o.size) | 0;
  return r;
}
function driveTwice(n) {
  let r = g0 | 0;
  for (let i = 0; i < n; ++i) r = read((i & 1) === 0 ? c : d, r);
  return r;
}
function driveOften(n) {
  let r = g0 | 0;
  for (let i = 0; i < n; ++i) r = readOften((i & 1) === 0 ? c : d, r);
  return r;
}
const rows = new Map([["twice", driveTwice], ["often", driveOften]]);
for (const row of [word.slice(0, 0) + "twice", word.slice(0, 0) + "often", word]) {
  const chosen = rows.get(row);
  if (chosen !== undefined) console.log(row, chosen(1000));
  else console.log("no row", row);
}
console.log(rows.size, read(rows, 0), readOften(launderLate(rows), 0), readOften(launderLate(new Set([1, 2, 3])), 0));

class Wider extends WithGetter {
  get size() { return super.size + 10; }
}
class Counted extends Map {}
const outcome = run => { try { return run(); } catch (error) { return error.constructor.name; } };
for (const through of [launder, launderLate]) {
  console.log(
    read(through(new Wider(1)), 0),
    read(through(new Counted([[1, 1], [2, 2]])), 0),
    read(through({ size: 7 }), 0),
    read(through({ get size() { return 8; } }), 0),
    read(through(Object.create(a)), 0),
    read(through({}), 0),
    read(through("text"), 0),
    outcome(() => read(through(null), 0)),
    outcome(() => read(through(Object.create(Map.prototype)), 0)),
  );
}

Object.defineProperty(b, "size", { value: 1, configurable: true });
console.log(read(a, 0), read(b, 0), readOften(a, 0), readOften(b, 0));
delete b.size;
Object.defineProperty(WithGetter.prototype, "size", { get() { return this.n + 100; }, configurable: true });
console.log(read(a, 0), read(b, 0), read(c, 0), readOften(d, 0), read(launder(new Wider(1)), 0));
delete WithGetter.prototype.size;
console.log(read(a, 0), readOften(c, 0), read(new Map([[1, 1]]), 0));
