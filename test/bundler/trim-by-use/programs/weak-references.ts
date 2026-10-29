let target: object | undefined = { name: "target" };
const reference = new WeakRef(target);
let cleaned = 0;
const registry = new FinalizationRegistry<string>(() => cleaned++);
const token = {};
registry.register(target, "held", token);
registry.register({}, "other");
console.log(
  (reference.deref() as any).name,
  registry.unregister(token),
  registry.unregister({}),
  Object.prototype.toString.call(reference),
  Object.prototype.toString.call(registry),
);
target = undefined;
Bun.gc(true);
await new Promise(resolve => setTimeout(resolve, 10));
Bun.gc(true);
console.log(typeof reference.deref(), typeof cleaned);
