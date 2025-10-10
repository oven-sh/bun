// Test loading a bare module.exports file
const chunk = require("./cjs-bare-module-exports.cjs");

console.log("Type:", typeof chunk);
console.log("Is Array:", Array.isArray(chunk));
console.log("Length:", chunk.length);
console.log("First element:", chunk[0]);
console.log("Second element type:", typeof chunk[1]);

// Test that we can call the functions in the array
const testObj = {};
chunk[1]({}, {}, testObj);
console.log("After calling function:", testObj.hello);

console.log("SUCCESS");
