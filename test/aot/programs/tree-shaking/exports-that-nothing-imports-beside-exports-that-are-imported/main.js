// values.js exports constants, classes, an object and a default in every form of export. The program imports a few of them; some imports are never used; the rest nobody imports.
import { used, renamedUsed, UsedClass, importedAndNeverRead, usedThroughOther } from "./values.js";
import neverReadDefault from "./values.js";
import { viaBarrel } from "./barrel.js";

console.log(used, renamedUsed, new UsedClass().name(), usedThroughOther.inner, viaBarrel);
