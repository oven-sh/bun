// The package says nothing about side effects. Its barrel re-exports six files, the program uses one name, and another file prints and registers a function when it is evaluated. `bun run` and `bun build --compile` print the same: second.js is evaluated.
import { fourth, registered } from "six-files";

console.log(fourth());
console.log(registered.map(entry => entry()).join());
