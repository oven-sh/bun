// What a call yields and nobody reads: where call resolution has put a guard in front of the call, the ways meet again in a block that would take the result as a parameter. Nobody looks at it, so nobody brings it.
// IR= 0 unused ^  b[1-9][0-9]*\(v
var splice = Array.prototype.splice, push = Array.prototype.push;
function unused(list, index) { splice.call(list, index, 1); return list.length; }
function unusedInLoop(list, count) { for (var i = 0; i < count; i++) push.call(list, i); return list.length; }
function used(list, index) { var removed = splice.call(list, index, 1); return removed.length + ":" + list.length; }
console.log(unused([1, 2, 3], 1), unused([], 0), unused({ length: 2, 0: 1, 1: 2 }, 0), unusedInLoop([], 5), unusedInLoop({ length: 1 }, 2), used([1, 2, 3], 5), used([1, 2, 3], 0));
splice = function (index) { this.length = index; return "mine"; };
console.log(unused([1, 2, 3], 1), used([1, 2, 3], 2));
