// The first read by name, and the later ones, of what an ordinary object has itself and of what neither it nor Object.prototype has, whatever gave the object its shape.
function grown(k) { const o = {}; o["p" + k] = k; o.alpha = 1; o.beta = 2; return o; }
function Made(i) { this.alpha = i; this.beta = i + 1; }
const parsed = text => JSON.parse(text);
const assigned = k => Object.assign({}, { alpha: k, beta: k + 1, ["q" + k]: 0 });
function alphaOf(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.alpha; return s; }
function betaOf(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.beta; return s; }
const sum = (o, turns) => alphaOf(o, turns) + betaOf(o, turns);
function lacksGamma(o, turns) { let n = 0; for (let i = 0; i < turns; i++) n += o.gamma === undefined ? 1 : 0; return n; }
function lacksThen(o, turns) { let n = 0; for (let i = 0; i < turns; i++) n += o.then === undefined ? 1 : 0; return n; }
const absent = (o, turns) => Math.min(lacksGamma(o, turns), lacksThen(o, turns));
const objects = [grown(1), grown(2), parsed('{"alpha":3,"beta":4}'), parsed('{"beta":5,"alpha":6,"more":7}'), assigned(1), assigned(2)];
console.log(objects.map(o => sum(o, 50)).join(), objects.map(o => absent(o, 50)).join());
function sumOfMade(o, turns) { let s = 0; for (let i = 0; i < turns; i++) s += o.alpha + o.beta; return s; }
function absentOfMade(o, turns) { let n = 0; for (let i = 0; i < turns; i++) n += o.gamma === undefined && o.then === undefined ? 1 : 0; return n; }
console.log(sumOfMade(new Made(1), 50), absentOfMade(new Made(1), 50));

// Keyed reads of the same pairs, and what changes afterwards.
function keyed(o, key, turns) { let s; for (let i = 0; i < turns; i++) s = o[key]; return s; }
console.log(objects.map(o => keyed(o, "al" + "pha", 20)).join(), objects.map(o => String(keyed(o, "gam" + "ma", 20))).join());
objects[0].gamma = "added";
delete objects[1].alpha;
Object.defineProperty(objects[2], "alpha", { get() { return 100; } });
Object.setPrototypeOf(objects[3], { gamma: "inherited", then: 1 });
Object.freeze(objects[4]);
console.log(objects.map(o => String(sum(o, 20))).join(), objects.map(o => absent(o, 20)).join(), objects.map(o => String(o.gamma)).join());
