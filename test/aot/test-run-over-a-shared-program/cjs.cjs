exports.twice = x => x * 2;
exports.obj = { from: "cjs" };
exports.Klass = class Klass { hi() { return "hi"; } };
module.exports.self = () => module.exports;
