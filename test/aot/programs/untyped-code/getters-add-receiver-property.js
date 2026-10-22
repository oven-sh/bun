// A getter on a prototype that defines, on the object it is read of, the property it stands for: a method bound at the first read. The read is of a kind of object that inherits an accessor, whatever the getter then does to the object: the run time is asked once for the kind, not once for each object.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTGetByIdAndCache");
class Schema {
  constructor(kind) { this.kind = kind; }
}
for (const name of ["optional", "describe", "clone"]) {
  Object.defineProperty(Schema.prototype, name, {
    get() {
      const bound = extra => this.kind + ":" + name + ":" + extra;
      Object.defineProperty(this, name, { value: bound, writable: true, configurable: true });
      return bound;
    },
    configurable: true,
  });
}
Object.defineProperty(Schema.prototype, "size", { get() { this.sized = (this.sized | 0) + 1; return this.kind.length; }, configurable: true });
function use(schema, i) {
  const first = schema.optional(i);
  const second = schema.optional(i + 1);
  return first.length + second.length + schema.describe("d").length + schema.size + schema.size + (Object.hasOwn(schema, "clone") ? 100 : 0) + schema.clone("c").length + (Object.hasOwn(schema, "clone") ? 1000 : 0);
}
let sum = 0;
for (let i = 0; i < 50; i++) sum += use(new Schema("k" + (i & 3)), i);
const before = visits();
for (let i = 0; i < 2000; i++) sum += use(new Schema("k" + (i & 3)), i);
console.log("2000 objects:", sum, "the run time is asked at most a hundred times:", typeof aotOperationCount !== "function" || visits() - before <= 100);
const one = new Schema("one");
console.log(one.optional(1), Object.keys(one).join(), Object.getOwnPropertyNames(one).join(), one.size, one.sized, one.size, one.sized);
Object.defineProperty(Schema.prototype, "optional", { get() { return () => "changed"; }, configurable: true });
const two = new Schema("two");
console.log(two.optional(1), Object.getOwnPropertyNames(two).join(), use(two, 1), one.optional(2));
delete Schema.prototype.describe;
let thrown = "";
try { use(new Schema("three"), 1); } catch (error) { thrown = error instanceof TypeError ? "a TypeError" : String(error); }
console.log(thrown);
