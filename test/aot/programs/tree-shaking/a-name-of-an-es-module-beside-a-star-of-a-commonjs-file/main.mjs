// `export *` from an ES module and from a CommonJS file, whose names are known when it has run. A name of the ES module is bound at the build, and the loader still compares it with the names of the CommonJS file, so the table of the file between has to list it.
import { a, b } from "says-nothing";
const { second } = await import("./second.mjs");
const { page } = await import("./page.mjs");
console.log(a(), b(), second(), page());
