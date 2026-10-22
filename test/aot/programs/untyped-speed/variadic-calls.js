// Calls with a varying number of arguments: `arguments` read in a loop, sliced and forwarded with `apply`, rest and spread, parameters left out, `call` with another receiver, and Math.max.apply.
function sum() {
  var total = 0;
  for (var i = 0; i < arguments.length; i++) total += arguments[i];
  return total;
}

function toArray(list, from) {
  return Array.prototype.slice.call(list, from || 0);
}

function partial(fn) {
  var bound = toArray(arguments, 1);
  return function () {
    return fn.apply(this, bound.concat(toArray(arguments)));
  };
}

function largest() {
  return Math.max.apply(Math, arguments);
}

function forward() {
  return sum.apply(null, arguments);
}

function rest(first, ...others) {
  return first * others.length + sum(...others);
}

function optional(a, b, c) {
  if (arguments.length === 1) return a;
  if (c === undefined) c = 10;
  return a + b + c;
}

var receiver = {
  base: 3,
  scaled: function (x, y) {
    return this.base * x + y;
  },
};

function run(count) {
  var addFive = partial(sum, 2, 3);
  var total = 0;
  for (var i = 0; i < count; i++) {
    var a = i & 15;
    total += sum(a, 1, 2) + forward(a, a, a, a) + largest(a, 7, 3);
    total += rest(a, 1, 2, 3) + optional(a) + optional(a, 1) + optional(a, 1, 2);
    total += receiver.scaled.call({ base: 2 }, a, 1) + receiver.scaled.apply(receiver, [a, 2]);
    if ((i & 7) === 0) total += addFive(a, 4);
  }
  return total;
}

console.log(run(1500000));
