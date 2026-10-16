var results = [];
var literal = { alpha: 1 };
literal.alpha = 2;
results.push(literal.alpha);
literal.beta = 3;
results.push(literal.beta);
var frozen = Object.freeze({ alpha: 1 });
frozen.alpha = 2;
results.push(frozen.alpha);
frozen.beta = 2;
results.push(frozen.beta);
var onlyGetter = { get fixed() { return 1; } };
onlyGetter.fixed = 2;
results.push(onlyGetter.fixed);
(5).alpha = 1;
results.push("a number took it");
"text".alpha = 1;
results.push("a string took it");
var refusing = new Proxy({}, { set: function () { return false; } });
refusing.alpha = 1;
results.push("a proxy refused in silence");
try {
  undefined.alpha = 1;
} catch (error) {
  results.push(error.constructor.name);
}
exports.first = 1;
module.exports.second = 2;
results.push(Object.keys(exports).join());
module.exports = results;
