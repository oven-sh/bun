// Tests for truthiness, object literals, constructors and reads of properties inside try, catch and finally: nested, in a generator, behind await, with throws before and after them.
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}

const values = [undefined, null, false, true, 0, -0, 1, NaN, 0.5, "", "a", [], {}, () => 0, Symbol.iterator, 0n, 7n];

function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.sum = function () {
  return this.x + this.y;
};

function classify(value, thrower) {
  let trail = "";
  try {
    if (value) trail += "t";
    else trail += "f";
    const made = { value, trail, nested: { deep: !value } };
    if (made.nested.deep) trail += "d";
    const point = new Point(trail.length, 2);
    point.z = made.absent;
    if (point.z) trail += "z";
    if (point.sum() > 3) trail += "s";
    if (thrower) thrower(trail);
    trail += "!";
  } catch (error) {
    if (error) trail += "c" + (typeof error === "function" || typeof error === "object" ? error.message ?? typeof error : String(error));
    else trail += "c-";
  } finally {
    if (!value) trail += "n";
    try {
      if (trail.length > 6 && value) throw trail.length;
    } catch (length) {
      trail += length ? "L" : "l";
    }
  }
  return trail;
}

say(values.map(value => classify(value, null)));
say(values.map(value => classify(value, trail => { throw new Error(trail); })));
say(values.map(value => classify(value, () => { throw value; })));

function whereThrown(depth, value) {
  try {
    if (value) {
      if (depth) return whereThrown(depth - 1, value);
      null.property;
    }
    return "nothing thrown";
  } catch (error) {
    const stack = String(error.stack).split("\n").filter(line => line.includes("whereThrown")).length;
    return [error.constructor.name, stack];
  }
}
say(whereThrown(0, 1), whereThrown(3, "x"), whereThrown(2, 0));

function* stepping(list) {
  for (const item of list) {
    try {
      if (item) yield { item, kind: typeof item };
      else yield { item: String(item), kind: "falsy" };
    } finally {
      if (item === 1) lines.push("left one");
    }
  }
}
say([...stepping([0, 1, "", "x", null])]);

async function waiting(list) {
  const seen = [];
  for (const item of list) {
    try {
      const got = await item;
      if (got) seen.push({ got });
      else throw got;
    } catch (reason) {
      seen.push(reason ? "reason" : "none");
    }
  }
  return seen;
}
let sum = 0;
for (let i = 0; i < 20000; ++i) {
  try {
    const point = new Point(i, i & 1 ? 0 : "");
    if (point.y) sum += 1;
    else if (point.x) sum += 2;
    if (i % 5000 === 4999) throw point;
  } catch (point) {
    if (point.x) sum += point.x;
  }
}
say("sum", sum);
waiting([1, 0, Promise.resolve(""), Promise.reject(new Error("no")), Promise.resolve({})]).then(seen => {
  say(seen);
  console.log(lines.join("\n"));
});
