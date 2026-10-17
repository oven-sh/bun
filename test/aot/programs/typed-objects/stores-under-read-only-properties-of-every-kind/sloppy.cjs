exports.storeByName = function (object, value) {
  object.free = value;
  return object.free;
};
exports.storeMethod = function (object, value) {
  object.method = value;
  return typeof object.method;
};
exports.storeByKey = function (object, key, value) {
  object[key] = value;
  return object[key];
};
exports.assign = function (object, source) {
  Object.assign(object, source);
  return object.free;
};
exports.add = function (object) {
  object.free += 1;
  return object.free;
};
