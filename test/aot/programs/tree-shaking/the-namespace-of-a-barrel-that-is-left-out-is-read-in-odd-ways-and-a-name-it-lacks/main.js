// As its neighbor, but the object is also asked for a name that it lacks and whether it has one, which only the object can answer: the barrel stays.
import * as ns from "stars";

console.log(typeof ns.missing, ns.missing === undefined, ns.missing?.(), "a" in ns, ns.a());
