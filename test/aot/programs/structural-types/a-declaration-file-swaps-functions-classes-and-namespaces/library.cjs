exports.Factory = function Factory(width) {
  return { width: String(width), grow: () => "grown" };
};

exports.Build = class Build {
  constructor(width) {
    this.width = width;
  }
};

exports.Arrow = () => ({ n: 1 });

exports.count = 5;
exports.label = "label";

exports.tools = function tools() {
  return "tools is a function";
};
exports.tools.limit = "ten";

exports.settings = class Settings {
  static depth = "deep";
};

exports.callable = { call: () => 1, apply: () => 2 };

exports.list = new Set([1, 2]);

let reads = 0;
Object.defineProperty(exports, "getter", { get: () => ++reads, enumerable: true });

exports.counter = 0;
exports.bump = function () {
  exports.counter = "bumped";
};
