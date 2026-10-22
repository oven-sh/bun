// The functions of node:module that a program can put its own in the place of are imported by name, read off the namespace object and off the default export, and called.
import Module, { _load, _resolveFilename, wrap } from "node:module";
import * as namespace from "node:module";
console.log(typeof wrap, typeof _load, typeof _resolveFilename);
console.log(wrap === Module.wrap, wrap === namespace.wrap, _load === Module._load, _resolveFilename === namespace._resolveFilename);
console.log(wrap("x").includes("x"), _resolveFilename("node:path"));
