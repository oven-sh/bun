// IR= 0 Names istFields
// IR= 0 OnlyExtended istFields
// IR= 1 StillRunsCode UnlistFields
// IR= 3 StillRunsCode ListFields
import * as typed from "./core.ts";
import { imported, reassign } from "./helpers.ts";
import { HeirOfNames, HeirOfOnlyExtended } from "./untyped.js";

for (const made of [typed.makeNames(), new HeirOfNames()]) console.log(Object.keys(made).join(), typed.sumOfNames(made), made.viaImport === imported, JSON.stringify(made));
const heir = new HeirOfOnlyExtended();
console.log(Object.keys(heir).join(), typed.sumOfOnlyExtended(heir), heir.viaImport === imported, JSON.stringify(heir));
const first = typed.makeStillRunsCode();
reassign();
const second = typed.makeStillRunsCode();
console.log(Object.keys(first).join(), first.seen, typed.sumOfStillRunsCode(first), typed.sumOfStillRunsCode(second));
