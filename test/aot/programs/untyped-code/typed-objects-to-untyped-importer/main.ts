// An untyped file imports functions of a full-types file and is handed the full-types file's own objects: it reads them, stores to them what fits, adds to them, and hands them back.
import { rows } from "./reader.js";
import { currentRoot, describe, labels, topOf } from "./state";
let sum = 0;
for (let i = 0; i < 1000; i++) sum += currentRoot().id.length + currentRoot().owner.use() + (topOf(currentRoot()) ?? "").length;
console.log("before", sum, describe());
for (const row of rows()) console.log(row.join(" | "));
console.log("after", describe(), labels());
