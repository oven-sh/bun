// Methods mixed into a prototype with Object.assign, accessors from Object.defineProperty and from a class, a setter that notifies listeners, and valueOf in a subtraction.
var Observable = {
  on: function (name, listener) {
    (this._listeners[name] || (this._listeners[name] = [])).push(listener);
    return this;
  },
  notify: function (name, value) {
    var list = this._listeners[name];
    if (!list) return 0;
    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i](value);
    return sum;
  },
};

var Comparable = {
  compareTo: function (other) {
    return this.valueOf() - other.valueOf();
  },
  max: function (other) {
    return this.compareTo(other) >= 0 ? this : other;
  },
};

function Temperature(celsius) {
  this._listeners = {};
  this._celsius = celsius;
}
Object.assign(Temperature.prototype, Observable, Comparable);
Object.defineProperty(Temperature.prototype, "celsius", {
  get: function () {
    return this._celsius;
  },
  set: function (value) {
    var before = this._celsius;
    this._celsius = value;
    if (before !== value) this.changes = (this.changes || 0) + this.notify("change", value - before);
  },
});
Object.defineProperty(Temperature.prototype, "fahrenheit", {
  get: function () {
    return (this._celsius * 9) / 5 + 32;
  },
});
Temperature.prototype.valueOf = function () {
  return this._celsius;
};

class Rectangle {
  constructor(width, height) {
    this._width = width;
    this._height = height;
  }
  get area() {
    return this._width * this._height;
  }
  get width() {
    return this._width;
  }
  set width(value) {
    this._width = value < 0 ? 0 : value;
  }
  static square(side) {
    return new Rectangle(side, side);
  }
}

function run(count) {
  var total = 0;
  var reference = new Temperature(20);
  var sensor = new Temperature(0).on("change", function (delta) {
    return delta > 0 ? 1 : 2;
  });
  sensor.on("change", function (delta) {
    return delta & 1;
  });
  var box = Rectangle.square(3);
  for (var i = 0; i < count; i++) {
    sensor.celsius = i % 40;
    total += sensor.fahrenheit + sensor.max(reference).celsius;
    box.width = (i % 7) - 1;
    total += box.area + box.width;
  }
  return total + sensor.changes;
}

console.log(run(1500000));
