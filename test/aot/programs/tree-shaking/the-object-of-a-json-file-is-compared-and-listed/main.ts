import data, * as all from "./data.json";
console.log(
  data === all.default,
  Object.keys(data).join(),
  data.version,
  (data as any).missing,
  data.list.length,
  data.list[1],
);
