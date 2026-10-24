// "sideEffects": false, and index.js only has `export *`, so the imports go past it and the file is not in the executable. Its namespace object is read by constant names in every way there is; a name that it lacks asks the object itself.
import * as ns from "stars";

console.log(ns?.a(), ns["a"](), ns.a?.(), (0, ns.a)());
console.log(typeof ns.a, new ns.Klass().m(), ns.value + 1, `${ns.value}`);
const kept = ns.a;
console.log(kept());
class Sub extends ns.Klass {}
console.log(new Sub().m(), new Sub() instanceof ns.Klass);
