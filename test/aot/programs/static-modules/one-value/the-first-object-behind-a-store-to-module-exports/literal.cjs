module.exports = { a: 1, seen() { return [exports.b, typeof exports.a, exports === module.exports].join("|"); } };
exports.b = 2;
this.c = 3;
