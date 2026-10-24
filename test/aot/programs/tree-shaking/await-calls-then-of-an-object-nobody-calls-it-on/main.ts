// `await` and Promise.resolve call the method `then` of a class instance, of an object literal and of a module namespace that exports a function named then.
import { Later, literal } from "./thenables";

console.log(await new Later("awaited"));
console.log(await Promise.resolve(new Later("resolved")));
console.log(await literal);
console.log(await (async () => new Later("returned from an async function"))());
console.log(await import("./namespace-with-then"));
