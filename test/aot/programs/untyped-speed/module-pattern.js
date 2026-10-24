// The module pattern: functions that share the variables of an enclosing call, among them a table of counters, an accumulator with chained calls, memoize and once.
var counters = (function () {
  var values = {};
  var total = 0;
  function bump(name, by) {
    if (values[name] === undefined) values[name] = 0;
    values[name] += by;
    total += by;
    return values[name];
  }
  function read(name) {
    return values[name] || 0;
  }
  return {
    bump: bump,
    read: read,
    total: function () {
      return total;
    },
  };
})();

function makeAccumulator(start) {
  var sum = start;
  var calls = 0;
  return {
    add: function (value) {
      calls++;
      sum += value;
      return this;
    },
    result: function () {
      return sum + calls;
    },
  };
}

function memoize(fn) {
  var cache = {};
  return function (key) {
    var hit = cache[key];
    if (hit !== undefined) return hit;
    return (cache[key] = fn(key));
  };
}

function once(fn) {
  var done = false;
  var value;
  return function () {
    if (!done) {
      done = true;
      value = fn();
    }
    return value;
  };
}

var square = memoize(function (n) {
  return n * n;
});
var seed = once(function () {
  return 17;
});
var names = ["alpha", "beta", "gamma", "delta"];

function run(count) {
  var accumulator = makeAccumulator(seed());
  for (var i = 0; i < count; i++) {
    counters.bump(names[i & 3], i & 15);
    accumulator.add(square(i & 63)).add(seed());
  }
  return accumulator.result() + counters.total() + counters.read("gamma") + counters.read("missing");
}

console.log(run(3000000));
