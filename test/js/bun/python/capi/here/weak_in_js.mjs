// JS's own weak references to an instance of the type of an extension. They refer to what JS sees of it, the face, which dies as any object does: before tp_dealloc is called.
import { describe, drop_and_collect, events, load, make, use } from "./instances_for_js.py";

load(process.argv[2]);
// What a WeakRef has been made of, or has handed out, is kept until the job ends.
const nextJob = () => new Promise(resolve => setImmediate(resolve));
const nothing = () => {};
let weak, taken;
const show = what =>
  console.log(
    what,
    "| events",
    events(),
    "| deref():",
    weak.deref() === undefined ? "undefined" : describe(weak.deref()),
  );

weak = new WeakRef(make(1, false, () => console.log("before its turn: deref():", String(weak.deref()))));
await nextJob();
drop_and_collect();
show("no cycle");

weak = new WeakRef(make(2, true, nothing));
await nextJob();
drop_and_collect();
show("a cycle through a list");

// The collection has found it in a cycle, and is about to ask it to let go. Nobody can tell that JS takes it.
weak = new WeakRef(make(3, true, () => (taken = weak.deref())));
await nextJob();
drop_and_collect();
show("the same, taken before its turn");
console.log(use(taken));
drop_and_collect();
show("still held");
taken = undefined;
await nextJob();
drop_and_collect();
show("dropped");
