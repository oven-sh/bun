exports.three = "3";
exports.point = { y: "2", x: "1" };
exports.step = function (n) {
  return n + "!";
};
exports.list = { 0: 1, 1: "2", length: 2 };
exports.make = function (kind) {
  return { number: 3, text: "3", nothing: null, list: [3], point: { x: 1, y: 2 }, texts: { x: "1", y: "2" } }[kind];
};
exports.Pixel = class Pixel {
  constructor(x, y) {
    this.y = y;
    this.x = x;
  }
};
exports.callBack = function (f) {
  return [f("1"), f(null), f.call("receiver", [2])];
};
