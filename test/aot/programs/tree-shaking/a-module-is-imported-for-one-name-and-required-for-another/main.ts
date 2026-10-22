// lib.ts is imported for `imported`. The other exports are reached through require: under a path that is computed, through a conditional path, and from a CommonJS file.
import { imported } from "./lib";
import { throughCommonJS } from "./reader.cjs";

console.log(imported());
const name = ["l", "i", "b"].join("");
console.log(require("./" + name + ".ts").underComputedPath());
console.log(require(name.length === 3 ? "./lib.ts" : "./other.ts").underConditionalPath());
console.log(throughCommonJS());
