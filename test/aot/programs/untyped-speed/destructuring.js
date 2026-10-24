// Destructuring of parameters and variables: defaults, nested patterns, rest elements and rest properties, a swap, and objects returned only to be taken apart.
function area({ width = 1, height = 1, unit: { scale = 1 } = {} } = {}) {
  return width * height * scale;
}

function head([first, second = 10, ...others]) {
  return first + second + others.length;
}

function swap(pair) {
  let [a, b] = pair;
  [a, b] = [b, a];
  return a * 2 + b;
}

function pick(source, ...names) {
  const out = {};
  for (const name of names) out[name] = source[name];
  return out;
}

function omitId({ id, ...others }) {
  return others;
}

const describe = ({ name, tags: [firstTag = "none"] = [] }) => `${name}:${firstTag}`;

function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function run(count) {
  const boxes = [{ width: 2, height: 3 }, { width: 4 }, { height: 5, unit: { scale: 2 } }, {}, undefined];
  const people = [{ id: 1, name: "ann", tags: ["x", "y"] }, { id: 2, name: "bob" }, { id: 3, name: "cy", tags: [] }];
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += area(boxes[i % 5]) + head([i & 3, 2, 3, 4]) + head([i & 1]) + swap([i & 7, 3]);
    const person = people[i % 3];
    total += describe(person).length;
    const { name, missing = 4 } = pick(person, "name", "id");
    total += name.length + missing;
    const { min, max } = minMax([i & 15, 7, i & 3]);
    total += max - min;
    if ((i & 3) === 0) total += Object.keys(omitId(person)).length;
  }
  return total;
}

console.log(run(700000));
