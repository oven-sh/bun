// What replaces a list in the body of a component stands where all of that list does, and so does each spread in it.
import { Rows } from "./Rows";

console.log(Rows({ first: [1], second: [2, 3] }));
