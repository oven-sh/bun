class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

const log = [];

function observed(name, x, y) {
  return {
    get x() {
      log.push(name + ".x");
      return x;
    },
    set x(value) {
      log.push(name + ".x = " + value);
    },
    get y() {
      log.push(name + ".y");
      return y;
    },
  };
}

function converted(name, value) {
  return {
    valueOf() {
      log.push(name + ".valueOf");
      return value;
    },
  };
}

function sum3(a, b, c) {
  return a.x + b.x + c.x;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function scale(a, k, m) {
  return a.x * k * m;
}

function storeBetween(a, b, c) {
  const x = a.x;
  b.x = x + 1;
  return x + c.x;
}

function callBetween(a, f, b) {
  const x = a.x;
  f(x);
  return x + b.x;
}

function allocateBetween(a, b) {
  const pair = [a.x, a.y];
  return pair[0] + b.x + pair.length;
}

function loopBetween(a, list, b) {
  let total = a.x;
  for (let i = 0; i < list.length; i++) total += list[i].x;
  return total + b.x;
}

const outside = JSON.parse(process.argv[2] ?? '[{"x":1000,"y":2000}]');
const points = [];
for (let i = 0; i < 8; i++) points.push(new Point(i + 0.5, i * 2 + 0.25));
for (const value of outside) points.push(value);

function show(name, result) {
  console.log(name, result, log.join(" "));
  log.length = 0;
}

function note(value) {
  log.push("called with " + value);
}

let total = 0;
for (let round = 0; round < 100; round++) {
  for (let i = 0; i + 2 < 8; i++) {
    const a = points[i];
    const b = points[i + 1];
    const c = points[i + 2];
    total += sum3(a, b, c) + cross(a, b) + scale(a, i, 0.5) + allocateBetween(a, b) + loopBetween(a, points, c);
  }
}
show("all tests pass", total);

const p = points[1];
const q = points[2];
const plain = points[8];

show("sum3 first", sum3(observed("a", 1, 2), p, q));
show("sum3 second", sum3(p, observed("b", 1, 2), q));
show("sum3 third", sum3(p, q, observed("c", 1, 2)));
show("sum3 all", sum3(observed("a", 1, 2), observed("b", 3, 4), observed("c", 5, 6)));
show("sum3 plain object third", sum3(p, q, plain));
show("sum3 undefined member", sum3(p, q, {}));
show("sum3 string member", sum3(p, q, { x: "text" }));

show("cross first", cross(observed("a", 1, 2), q));
show("cross second", cross(p, observed("b", 3, 4)));

show("scale second", scale(p, converted("k", 3), 2));
show("scale third", scale(p, 3, converted("m", 2)));
show("scale both", scale(p, converted("k", 3), converted("m", 2)));
show("scale bigint", (() => {
  try {
    return scale(p, 3, 2n);
  } catch (error) {
    return error.constructor.name;
  }
})());

const changed = new Point(1, 2);
points.push(changed);
show(
  "second changes first",
  sum3(
    changed,
    {
      get x() {
        log.push("b.x");
        changed.x = 100;
        return 10;
      },
    },
    changed,
  ),
);

const aliased = new Point(1, 2);
points.push(aliased);
show("store, then third fails", storeBetween(aliased, aliased, observed("c", 5, 6)));
show("stored once", aliased.x);
show("store into second fails", storeBetween(p, observed("b", 3, 4), q));

show("call, then last fails", callBetween(p, note, observed("b", 3, 4)));
show("allocation, then last fails", allocateBetween(p, observed("b", 3, 4)));
show("loop, then last fails", loopBetween(p, [q, observed("element", 7, 8), q], observed("b", 3, 4)));

show("null third", (() => {
  try {
    return sum3(observed("a", 1, 2), p, null);
  } catch (error) {
    return error.constructor.name;
  }
})());
