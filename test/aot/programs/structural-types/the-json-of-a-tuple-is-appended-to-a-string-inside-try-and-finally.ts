function describe(value: unknown): string {
  if (typeof value !== "object") return "something else";
  return "object";
}
function probe(pair: [number, string]): string {
  let out = "";
  try {
    out += "\nsum " + describe(pair[0] + 1);
    out += "\njoined " + describe(pair.join());
    out += "\njson " + describe(JSON.stringify(pair));
  } finally {
    out += "\nfinally reached";
  }
  return out;
}
console.log(probe([1, "ab"]));
console.log(probe(JSON.parse(JSON.stringify([1, "ab"]))));
