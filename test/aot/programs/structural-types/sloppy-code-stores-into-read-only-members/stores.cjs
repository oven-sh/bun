exports.mode = function () {
  return this === undefined ? "strict" : "sloppy";
};

exports.setX = function (point, value) {
  point.x = value;
  return point.x;
};

exports.setBoth = function (point, value) {
  point.x = value;
  point.y = value;
  return point.x + "," + point.y;
};

exports.incrementX = function (point) {
  return point.x++;
};

exports.addToX = function (point, value) {
  return (point.x += value);
};

exports.setByName = function (point, name, value) {
  point[name] = value;
  return point[name];
};

exports.patternIntoX = function (point, value) {
  [point.x] = [value];
  return point.x;
};

exports.fill = function (points, value) {
  var stored = 0;
  for (var i = 0; i < points.length; i++) {
    points[i].x = value;
    if (points[i].x === value) stored++;
  }
  return stored;
};
