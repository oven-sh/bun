// Untyped on purpose. The shape of an object refers to its realm, its prototype, the shape it came from or its rare data, its property table if that is pinned, and in a collection of the young to the one shape that follows it. Objects of every kind of shape must read, list and grow as before after any mix of collections.
const collect = globalThis.Bun ? full => globalThis.Bun.gc(full) : full => (full ? fullGC() : edenGC());
function churn(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += { a: i, b: "t" + i, c: [i] }.b.length;
  return sum;
}
function describe(o) {
  let text = "";
  for (const key in o) text += key + "=" + (typeof o[key] === "object" ? "o" : typeof o[key] === "function" ? "f" : o[key]) + ",";
  return text + Object.keys(o).length + "/" + Object.getOwnPropertyNames(o).length;
}
function chain(prefix, n) {
  const o = {};
  for (let i = 0; i < n; i++) o[prefix + i] = i;
  return o;
}
const kept = [];
for (let round = 0; round < 20; round++) {
  const plain = chain("p", 3 + (round % 9));
  const branch = chain("p", 3);
  branch["branch" + round] = round;
  const dictionary = chain("d", 40);
  for (let i = 0; i < 40; i += 3) delete dictionary["d" + i];
  dictionary["late" + round] = round;
  const huge = chain("h", 90 + round);
  const frozen = Object.freeze(chain("f", 4));
  const sealed = Object.seal(chain("s", 5));
  const closed = Object.preventExtensions(chain("c", 2));
  const proto = { inherited: round, method() { return this.own + this.inherited; } };
  const heir = Object.create(proto);
  heir.own = round * 2;
  const moved = chain("m", 3);
  Object.setPrototypeOf(moved, round % 2 ? proto : null);
  const bare = Object.create(null);
  bare.x = round;
  const withSymbol = { [Symbol.for("s" + (round % 3))]: round, plain: 1 };
  const accessor = Object.defineProperty(chain("a", 2), "hidden", { value: round, enumerable: false });
  const indexed = chain("i", 2);
  indexed[0] = "zero";
  indexed[5] = "five";
  const array = Object.assign([1, 2, 3], { extra: round });
  function Made(n) {
    this.n = n;
    this.twice = n * 2;
  }
  Made.prototype.sum = function () {
    return this.n + this.twice;
  };
  const made = new Made(round);
  class Base {
    base = round;
  }
  class Derived extends Base {
    derived = round + 1;
    static count = round;
  }
  const instance = new Derived();
  const all = [plain, branch, dictionary, huge, frozen, sealed, closed, heir, moved, bare, withSymbol, accessor, indexed, array, made, instance];
  if (round % 4 === 0) kept.push(all);
  churn(3000);
  collect(round % 6 === 5);
  if (round % 3 === 0) collect(false);
  let text = "";
  for (const o of all) text += describe(o).length + ":";
  console.log("round", round, text, heir.method(), made.sum(), Derived.count, Object.isFrozen(frozen), Object.isSealed(sealed), Object.isExtensible(closed), Object.getOwnPropertySymbols(withSymbol).length, accessor.hidden);
  // Grow again along chains whose objects of the last round are gone.
  const again = chain("p", 12);
  again.tail = round;
  if (describe(again) !== "p0=0,p1=1,p2=2,p3=3,p4=4,p5=5,p6=6,p7=7,p8=8,p9=9,p10=10,p11=11,tail=" + round + ",13/13") console.log("WRONG", describe(again));
}
collect(true);
churn(20000);
collect(false);
for (const all of kept) {
  let text = "";
  for (const o of all) text += describe(o) + "|";
  console.log(text.length, text.slice(0, 120));
  all[2].more = 1;
  all[3].more = 2;
  all[0].more = 3;
  console.log(Object.keys(all[2]).length, Object.keys(all[3]).length, Object.keys(all[0]).join());
}
