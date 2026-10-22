const name = "./a" + (Date.now() > 0 ? ".cjs" : "");
console.log("by name", require(name).x, globalThis.ran);
console.log("static", require("./a.cjs").x, require("./b.cjs").y, globalThis.ran);
