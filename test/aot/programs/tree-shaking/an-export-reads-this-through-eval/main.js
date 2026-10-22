// start() never writes `this`: the text it gives to eval does. It is called as a member of the namespace of a barrel, and `other` is declared in a file that has no eval.
import * as barrel from "./barrel.js";

console.log(barrel.start());
