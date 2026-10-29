const json = JSON as unknown as { rawJSON(text: unknown): object; isRawJSON(value: unknown): boolean };
const raw = json.rawJSON("12345678901234567890");
console.log(
  JSON.stringify({
    big: raw,
    list: [json.rawJSON('"text"'), json.rawJSON("null"), json.rawJSON("-1.50e3"), json.rawJSON(true)],
  }),
);
console.log(
  json.isRawJSON(raw),
  json.isRawJSON({}),
  Object.isFrozen(raw),
  Object.getPrototypeOf(raw),
  JSON.stringify(Object.keys(raw)),
);
console.log(JSON.stringify(json.rawJSON('"日本"')));
for (const bad of ["", " 1", "1 ", "{}", "[1]", "nope", '"open']) {
  try {
    json.rawJSON(bad);
    console.log("accepted", bad);
  } catch (error) {
    console.log((error as Error).name, (error as Error).message);
  }
}
