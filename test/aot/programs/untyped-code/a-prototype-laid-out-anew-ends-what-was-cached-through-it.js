// A prototype that loses properties may be laid out anew later on. What has been cached about its other properties ends then.
const text = []; for (let i = 0; i < 90; i++) text.push('"p' + i + '":' + i);
const proto = JSON.parse("{" + text.join() + "}");
// More structures than a site keeps for itself.
const heirs = [];
for (let i = 0; i < 48; i++) { const o = Object.create(proto); o["own" + i] = i; heirs.push(o); }
function read(o) { return o.p60 + o.p70 * 100 + o.p80 * 10000; }
function sum() { let s = 0; for (const o of heirs) s += read(o); return s; }
let stored = 0;
Object.defineProperty(proto, "p85", { set(v) { stored += v; }, get() { return 85; }, configurable: true });
function store(o) { o.p85 = 1; }
const seen = new Set();
const look = () => { seen.add(sum()); for (const o of heirs) store(o); };
for (let i = 0; i < 40; i++) look();
// Names nobody has read come and go, each removed when it is no longer the last.
for (let i = 0; i < 200; i++) {
  Reflect.set(proto, "passing" + i, i);
  if (i) Reflect.deleteProperty(proto, "passing" + (i - 1));
  if (i % 20 === 0) { Reflect.deleteProperty(proto, "p" + (i / 20)); look(); }
  if (i % 50 === 0) Object.defineProperty(proto, "p" + (20 + i / 50), { enumerable: false });
}
look();
// Sites that are new get taught: the chain is prepared for them.
function late(o) { return o.p81; }
function later(o) { return o.p82 === undefined; }
let more = 0;
for (let i = 0; i < 40; i++) { more += late(heirs[i]) + (later(heirs[i + 1]) ? 1 : 0); look(); }
console.log([...seen].join(), more, stored);
proto.p5 = "back";
for (let i = 0; i < 5; i++) look();
console.log([...seen].join(), heirs[3].p5, heirs[3].p6, heirs[3].p12, Object.keys(proto).length, stored);
