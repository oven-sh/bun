// Three getters that hand on to an inner object, defined by a loop over their names, beside a class that spells the three out. A read through the one may cost a few times what a read through the other costs, not five times.
const above = {};
for (const name of ["a", "b", "c"]) {
  Object.defineProperty(above, name, {
    get() {
      return this.inner[name];
    },
    configurable: true,
  });
}
class Declared {
  constructor(inner) {
    this.inner = inner;
  }
  get a() {
    return this.inner.a;
  }
  get b() {
    return this.inner.b;
  }
  get c() {
    return this.inner.c;
  }
}
const defined = Object.create(above);
defined.inner = { a: 1, b: 2, c: 3 };
const declared = new Declared({ a: 1, b: 2, c: 3 });
let sums = 0;
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const ofTheClass = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + declared.a + declared.b + declared.c + i) | 0;
  sums = (sums + sum) | 0;
});
const ofTheLoop = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + defined.a + defined.b + defined.c + i) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, Object.getOwnPropertyNames(above).join());
console.log(ofTheLoop < ofTheClass * 5 ? "under five times the time" : "over five times the time");
