import data, { count, name } from "./data.json";
class Box {
  first = data.count;
  second = count;
}
function pick(c = data.count, d = count) {
  switch (c) {
    case data.count:
      return data.inner.text;
    default:
      return d;
  }
}
console.log(
  data.count.toFixed(1),
  data.name.length,
  data.name?.toUpperCase(),
  typeof data.flag,
  new Box(),
  pick(),
  pick(1),
  { name, [data.inner.text]: count },
  `${data.name}${name}`,
  !data.flag,
  name.toUpperCase(),
  count.toFixed(2),
  (() => name + data.name)(),
);
