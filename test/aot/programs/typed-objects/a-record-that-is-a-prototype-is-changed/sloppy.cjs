exports.makeOver = function (prototype, a, b) {
  const self = Object.create(prototype);
  self.a = a;
  self.b = b;
  return self;
};
exports.store = function (object, name, value) {
  object[name] = value;
  return Object.keys(object).join();
};
