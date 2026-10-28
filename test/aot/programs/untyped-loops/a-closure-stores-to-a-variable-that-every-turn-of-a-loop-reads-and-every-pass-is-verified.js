// Every turn of a loop reads a variable in the function's own text and stores to it in a closure that it calls on the spot, and adds what it read to a variable of the module.
let out = "";

function byAnArrow(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    out += n + ",";
    (() => (n &= -1))();
    out += n + ",";
  }
}
byAnArrow({ a: 1 }, 3);
out += "\n";

function byAGetter(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    out += n + ",";
    ({
      get x() {
        return (n &= -1);
      },
    }).x;
  }
}
byAGetter({ a: 1 }, 3);
out += "\n";

function byADefault(start, turns) {
  var n = start;
  for (var turn = 0; turn < turns; turn++) {
    out += n + ",";
    ((p = (n &= -1)) => p)();
    out += n + ",";
  }
}
byADefault({ a: 1 }, 3);
out += "\n";

function byAFunctionOutOfAList(start, turns) {
  let n = start,
    turn = 0;
  while (turn++ < turns) {
    out += n + ",";
    (0, [() => (n &= -1)][0])();
    out += n + ",";
  }
}
byAFunctionOutOfAList({ a: 1 }, 3);
out += "\n";

function byCall(start, turns) {
  let n = start,
    turn = 0;
  do {
    out += n + ",";
    (function () {
      return (n &= -1);
    }).call(null);
  } while (++turn < turns);
}
byCall({ a: 1 }, 3);
out += "\n";

function byATag(start, turns) {
  for (let turn = 0; turn < turns; turn++) {
    out += start + ",";
    (() => (start &= -1))``;
    out += start + ",";
  }
}
byATag({ a: 1 }, 3);
out += "\n";

function withoutAClosure(start, turns) {
  let n = start;
  for (let turn = 0; turn < turns; turn++) {
    out += n + ",";
    n &= -1;
    out += n + ",";
  }
}
withoutAClosure({ a: 1 }, 3);

console.log(out);
