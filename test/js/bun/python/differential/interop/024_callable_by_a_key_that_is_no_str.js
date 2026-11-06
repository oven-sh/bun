// Whether an object can be called is a question that JS takes to have no effects, and the collector asks it too, of the frames that the
// sampling profiler has seen. So no key in the dict of a class is asked whether it equals "__call__", and what such a key has said to Python
// before makes no difference.
import { profile } from "bun:jsc";
import m from "./024_callable_by_a_key_that_is_no_str.py";

const names = ["only_by_key", "derived", "beside_a_key", "not_at_all"];
const each = f => names.map(name => f(m[name])).join(" ");
const call = o => { try { return o(); } catch (error) { return error.constructor.name; } };

m.times_asked();
for (const when of ["before", "after"]) {
  console.log(when, "| typeof:", each(o => typeof o), "| asked:", m.times_asked());
  console.log(when, "| called by JS:", each(call), "| asked:", m.times_asked() > 0);
  console.log(when, "| instanceof Function:", each(o => o instanceof Function), "| asked:", m.times_asked());
  if (when === "before") {
    console.log("callable():", each(m.is_callable), "| asked:", m.times_asked() > 0);
    console.log("called by Python:", each(m.call_it));
    m.times_asked();
  }
}

for (const name of ["raises", "collects", "allocates", "only_by_key", "beside_a_key"]) {
  const o = m[name];
  let results = new Set();
  profile(() => {
    for (const end = performance.now() + 250; performance.now() < end; ) results.add(call(o));
  }, 50);
  console.log("under the profiler:", name, [...results].join(" "));
}
