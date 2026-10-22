// require() and import() inside functions that nobody calls load nothing. The same calls inside a function that is called load their files then, and what they return is whole.
function neverRequires() { return require("./never-required.js"); }
const neverImports = () => import("./never-imported.js");
function requires() { return require("./required.js"); }
async function imports() { return import("./imported.js"); }

console.log("before");
console.log(requires()["na" + "me"]());
console.log((await imports())["na" + "me"]());
