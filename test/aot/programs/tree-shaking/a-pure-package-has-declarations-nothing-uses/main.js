// "sideEffects": false. Of one file of the package a constant is used that needs two others; beside them stand constants nobody uses, one of which calls something. Of another file only a class is used, of a third nothing.
import { used } from "parts/constants.js";
import { Used } from "parts/classes.js";
import { neverUsed } from "parts/nothing.js";

console.log(used.text, new Used().name());
