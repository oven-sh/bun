// The file with the eval imports from a barrel, so the functions its text names are declared two files away. One import is a namespace of the barrel, one a default that the barrel makes from a name.
import { far } from "./barrel.js";
import madeDefault from "./barrel.js";
import * as barrel from "./barrel.js";

function run(text) {
  return eval(text);
}
console.log(run("far()"), run("madeDefault()"), run("barrel.onlyInNamespace()"), run("barrel.inner.deep()"));
