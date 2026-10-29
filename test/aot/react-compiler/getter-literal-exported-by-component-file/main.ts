// A component file exports an object literal with a getter, and a typed file names the type of that literal.
import { View, shared } from "./View";
import { keptValue } from "./state";
function sum(of: typeof shared): number { return of.value + of.n; }
console.log(View({ title: "lazy" }), keptValue(), sum(shared));
