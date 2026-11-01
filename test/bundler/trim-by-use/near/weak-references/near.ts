let target: object | undefined = { name: "target" };
const map = new WeakMap([[target, "held"]]);
const set = new WeakSet([target]);
console.log(
  map.get(target),
  set.has(target),
  map.has({}),
  set.has({}),
  Object.prototype.toString.call(map),
  Object.prototype.toString.call(set),
);
target = undefined;
for (let i = 0; i < 1000; i++) map.set({}, "x");
Bun.gc(true);
await new Promise(resolve => setTimeout(resolve, 10));
Bun.gc(true);
{
  using resource = {
    [Symbol.dispose]() {
      console.log("disposed");
    },
  };
  console.log(typeof resource);
}
console.log(new AbortController().signal.aborted, typeof new Map().get(1));
