function callable(x) {
  return "called " + x;
}
callable.helper = "helper";
callable.count = 0;
callable.touch = function () {
  return ++callable.count;
};
module.exports = callable;
