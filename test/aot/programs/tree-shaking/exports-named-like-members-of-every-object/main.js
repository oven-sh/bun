// A namespace object inherits nothing, so exports named toString, valueOf, constructor, hasOwnProperty and __proto__ are ordinary exports. Some are called by name, some by the engine when the namespace is turned into text, a number or JSON.
import * as named from "./named.js";
import * as converted from "./converted.js";
import { toString, hasOwnProperty, constructor } from "./imported.js";

console.log(named.toString(), named.valueOf(), named.constructor(), named.hasOwnProperty("x"), named.__proto__(), named.isPrototypeOf());
console.log(`${converted}`, converted + 1, JSON.stringify({ converted }));
console.log(toString(), hasOwnProperty(), constructor());
