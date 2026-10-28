// A small CommonJS package: a priority queue, three utility functions and a printf-like formatter, each in a file of its own under lib/ and loaded with require.
"use strict";
var Queue = require("./lib/queue");
var util = require("./lib/util");
var format = require("./lib/format").format;

function run(count) {
  var queue = new Queue({ limit: 64 });
  var total = 0;
  for (var i = 0; i < count; i++) {
    queue.push({ id: i, priority: util.hash(i) & 7 });
    if (queue.size() > 32) total += queue.pop().priority;
    if ((i & 255) === 0) total += format("%s of %d (%j)", "item", i, { i: i & 3 }).length;
    total += util.isObject(queue) ? 1 : 0;
  }
  return total + util.defaults({ a: 1 }, { a: 2, b: 3 }).b + queue.size();
}

console.log(run(1500000));
