import data from "./data.json";
console.log(
  data.a,
  data["0"],
  data["1.5"],
  data.constructor,
  data.toString,
  data["with space"],
  data["é"],
  data.é,
  data.日本,
  data[""],
);
console.log(
  data.big,
  Object.is(data.minus, -0),
  data.long,
  data.text.length,
  data.text,
  data.default,
  data.then,
  data.length,
);
