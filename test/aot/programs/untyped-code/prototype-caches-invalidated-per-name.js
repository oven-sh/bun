// What reads by name have learnt about prototypes is forgotten name by name when a prototype changes, through many names, many shapes, many changes and collections in between.
const collect = typeof gc === "function" ? gc : typeof Bun !== "undefined" ? () => Bun.gc(true) : () => { };
const roots = [];
for (let r = 0; r < 6; r++) roots.push({ tag: "root" + r });
const middles = roots.map((root, r) => Object.assign(Object.create(root), { middle: r }));
function shape(parent, k) { const o = Object.create(parent); for (let i = 0; i <= k % 5; i++) o["own" + i] = i; return o; }
const objects = [];
for (let k = 0; k < 120; k++) objects.push(shape(middles[k % middles.length], k));
function readAll(o) { return [o.tag, o.middle, o.alpha, o.beta, o.gamma, o.delta, o.epsilon, o.zeta, o.eta, o.theta].map(String).join("/"); }
function digest() { let h = 0; for (const o of objects) { const text = readAll(o); for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; } return h; }
const names = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
const lines = [];
lines.push(digest(), digest());
for (let round = 0; round < 12; round++) {
  const name = names[round % names.length];
  const holder = round % 3 === 0 ? roots[round % roots.length] : round % 3 === 1 ? middles[round % middles.length] : objects[round * 7 % objects.length];
  holder[name] = name + round;
  lines.push(digest());
  if (round % 4 === 3) { collect(); lines.push(digest()); }
  if (round % 5 === 4) { delete roots[(round + 1) % roots.length][names[(round + 3) % names.length]]; delete middles[round % middles.length][names[(round + 6) % names.length]]; lines.push(digest()); }
  if (round % 6 === 5) { Object.setPrototypeOf(middles[round % middles.length], roots[(round + 2) % roots.length]); lines.push(digest()); }
}
for (let k = 0; k < 60; k++) objects[k] = shape(middles[(k + 1) % middles.length], k + 3);
collect();
lines.push(digest());
Object.defineProperty(roots[0], "alpha", { get() { return "got by " + (this.middle ?? this.tag); }, configurable: true });
lines.push(digest(), readAll(objects[0]), readAll(objects[6]), readAll(objects[119]));
console.log(lines.join("\n"));
