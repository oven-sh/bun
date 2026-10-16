module.exports = function storeSloppily(object, value) {
  object.value = value;
  return object;
};
