// Members stored through the function's own name on both sides of `module.exports = api`, and through `module.exports`: one property each, whichever way it is named, from inside and from outside.
const api = require("./api.cjs");
api.bump();
api.bump();
console.log(api(), api.count);
api.reset();
console.log(api.count, require("./api.cjs").count, Object.keys(api).join());
api.count = 7;
console.log(api());
