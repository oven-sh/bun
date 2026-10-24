// ES imports run before the body, depth first, in the order of the text.
console.log("main");
import "./a.mjs";
import "./b.mjs";
