// A barrel without side effects imports a file that is left out and then hands on all names of two CommonJS files: which names those are is known when they have run.
import { a, b } from "p";
console.log(a, b);
