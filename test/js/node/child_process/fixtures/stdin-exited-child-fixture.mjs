// The rows of stdin-exited-child-fixture.js from a program that is an ES module with a pending top-level await:
// another function of Bun's event loop runs it.
import { createRequire } from "node:module";

const { table } = createRequire(import.meta.url)("./stdin-exited-child-fixture.js");
console.log(JSON.stringify(await table(process.argv[2], process.argv[3])));
