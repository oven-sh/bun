// Two literals are let out as `unknown`. The second fits the type of a literal within the first, and a third literal of that structure is assigned over a member of a written type. Untyped code changes the second in every way.
type Written = { next?: { y?: number }; y: number[] };
function self(this: unknown): unknown {
  return this;
}
const first: unknown = [{ y: [6], next: { y: 18 } }].at(0);
Object.assign(first as Written, { y: [6, 3], next: { y: 64 } });
const second: unknown = self.bind({ y: 2, list: 8 })();
(second as any).list = null;
(second as any).y = "many";
delete (second as any).list;
Object.defineProperty(second as any, "y", { get() { return "got"; }, enumerable: true, configurable: true });
console.log(JSON.stringify(first), JSON.stringify(second), Object.keys(second as object).join());
