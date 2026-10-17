// In plain JavaScript, TypeScript's advice that two fresh objects are never equal (TS2839) is a warning: the program is valid and is built.
console.log({} !== {}, [] == [], {} === {}, /a/ != /a/, [1] === [1]);
if ({} === {}) console.log("never");
else console.log("compared by reference");
