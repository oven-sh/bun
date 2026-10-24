// `new F(..)` where F is known and short: its stores to `this` stand right behind the allocation. The object inherits a setter, a getter alone, or a read-only property for one of the names.
// What the objects have, in which order things happen, and that the run time does not construct every one of them. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const log = [];
function note(text) { if (log.length < 6) log.push(text); }
function prototypeOf(constructor) { return Object.getPrototypeOf(Object.create(constructor.prototype)); }
function describe(object) { return object.constructor.name + " " + Object.keys(object).map(key => key + "=" + JSON.stringify(object[key])).join(); }

function WithSetter(value) {
  this.a = value;
  this.b = [];
  this.guarded = value;
  this.c = null;
  this.d = "";
}
Object.defineProperty(prototypeOf(WithSetter), "guarded", { get() { return "got " + this.kept; }, set(value) { note("set behind " + Object.keys(this).join()); this.kept = value; }, configurable: true });
class WithAccessor {
  constructor(value) {
    this.first = 1;
    this.celsius = value;
    this.last = 2;
  }
  get celsius() { return this.kelvin - 273; }
  set celsius(value) { this.kelvin = value + 273; }
}
function ReadOnly(value) {
  this.a = value;
  this.fixed = value;
  this.b = 2;
}
Object.defineProperty(prototypeOf(ReadOnly), "fixed", { value: "for good", writable: false });
function GetterAlone(value) {
  this.a = value;
  this.computed = value;
  this.b = 2;
}
Object.defineProperty(prototypeOf(GetterAlone), "computed", { get() { return "always"; } });
function Plain(value) {
  this.a = value;
  this.guarded = value;
  this.fixed = 1;
  this.computed = 2;
}

const said = new Set();
const before = count("operationAOTCreateThis");
for (let i = 0; i < 3000; i++) {
  const made = new WithSetter(i & 1);
  said.add(describe(made) + " " + made.guarded);
  const degrees = new WithAccessor(i & 1);
  said.add(describe(degrees) + " " + degrees.celsius);
  said.add(describe(new Plain(i & 1)));
  for (const attempt of [() => new ReadOnly(i & 1), () => new GetterAlone(i & 1)]) {
    try {
      const object = attempt();
      said.add(describe(object) + " " + object.fixed + " " + object.computed);
    } catch (error) {
      said.add(error.constructor.name);
    }
  }
}
const constructed = count("operationAOTCreateThis") - before;
console.log([...said].join("\n"));
console.log(log.splice(0, 2).join("\n"));
console.log(constructed <= 200 ? "the run time constructed at most 200 of them" : "the run time constructed " + constructed + " of them");

// The setter goes, comes back, throws, changes the object under the stores that follow.
delete prototypeOf(WithSetter).guarded;
for (let i = 0; i < 40; i++) said.add(describe(new WithSetter(7)));
console.log(describe(new WithSetter(7)));
let seen;
Object.defineProperty(prototypeOf(WithSetter), "guarded", { set(value) { seen = this; throw new RangeError("from the setter"); }, configurable: true });
try {
  new WithSetter(8);
} catch (error) {
  console.log(error.message, describe(seen));
}
Object.defineProperty(prototypeOf(WithSetter), "guarded", { set(value) { this.d = "early"; delete this.a; this.extra = true; }, configurable: true });
for (let i = 0; i < 40; i++) new WithSetter(9);
console.log(describe(new WithSetter(9)));
Object.defineProperty(prototypeOf(WithSetter), "guarded", { set(value) { seen = Object.preventExtensions(this); }, configurable: true });
try {
  new WithSetter(10);
  console.log(describe(seen));
} catch (error) {
  console.log(error.constructor.name, describe(seen));
}
Object.setPrototypeOf(prototypeOf(WithSetter), new Proxy({}, { set(target, key, value, receiver) { note("proxy " + String(key)); return Reflect.set(target, key, value, receiver); } }));
delete prototypeOf(WithSetter).guarded;
log.length = 0;
console.log(describe(new WithSetter(11)), log.join());
