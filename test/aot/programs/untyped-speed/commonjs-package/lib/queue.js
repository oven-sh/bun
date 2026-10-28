"use strict";
var util = require("./util");

function Queue(options) {
  if (!(this instanceof Queue)) return new Queue(options);
  this.options = util.defaults(options || {}, { limit: 16 });
  this.items = [];
}

Queue.prototype.size = function () {
  return this.items.length;
};

Queue.prototype.push = function (item) {
  var items = this.items;
  var at = items.length;
  items.push(item);
  while (at > 0) {
    var parent = (at - 1) >> 1;
    if (items[parent].priority <= items[at].priority) break;
    var held = items[parent];
    items[parent] = items[at];
    items[at] = held;
    at = parent;
  }
  return this;
};

Queue.prototype.pop = function () {
  var items = this.items;
  var top = items[0];
  var last = items.pop();
  if (items.length === 0) return top;
  items[0] = last;
  var at = 0;
  for (;;) {
    var left = at * 2 + 1;
    var right = left + 1;
    var least = at;
    if (left < items.length && items[left].priority < items[least].priority) least = left;
    if (right < items.length && items[right].priority < items[least].priority) least = right;
    if (least === at) return top;
    var held = items[least];
    items[least] = items[at];
    items[at] = held;
    at = least;
  }
};

module.exports = Queue;
