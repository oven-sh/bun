import { Map } from "immutable";

// One copy of the package: the class of the import is the class of the require().
console.log("one copy = " + (require("immutable").Map() instanceof Map));
