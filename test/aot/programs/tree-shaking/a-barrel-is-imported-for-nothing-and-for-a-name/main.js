// Three files of the program import the barrel of one pure package: one for nothing at all, one for a name it never uses, one for a name it uses. The barrel has a line of its own that prints.
import "./for-nothing.js";
import "./for-an-unused-name.js";
import { result } from "./for-a-name.js";

console.log(result);
