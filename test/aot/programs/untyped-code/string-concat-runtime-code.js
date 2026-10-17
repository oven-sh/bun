// Functions made at run time join strings with + and +=: flat strings and ropes, Latin-1 and UTF-16, empty ones, strings with what is no string, and strings too long to join.
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const join = new Function("a", "b", "return a + b;");
const append = new Function("text", "more", "text += more; text += more; return text;");
const build = new Function("parts", "let text = ''; for (let i = 0; i < parts.length; i++) text += parts[i]; return text;");
const quote = new Function("name", "value", "let json = '{'; json += '\"' + name + '\":'; json += value; json += '}'; return json;");
const three = new Function("a", "b", "c", "return a + b + c;");
const show = value => (typeof value === "string" ? value.length + ":" + JSON.stringify(value.length > 60 ? value.slice(0, 20) + ".." + value.slice(-20) : value) : typeof value + " " + String(value));
const attempt = run => {
  try {
    return show(run());
  } catch (error) {
    return "throws " + error.constructor.name;
  }
};
const long = "abcdefghij".repeat(100);
const values = () => [
  "", "a", "é", "中", "😀", "\ud800", "\udc00", "ab", long, long + "x", long.slice(1, 50), "x" + lines.length, "中" + lines.length, String(lines.length), long.slice(5, 5),
  0, -0, 1.5, NaN, true, null, undefined, 10n, [], [1, 2], {}, { toString: () => "mine" }, { valueOf: () => 7 }, { [Symbol.toPrimitive]: () => "primitive" }, new String("boxed"),
];
for (let round = 0; round < 3; round++) {
  const left = values(), right = values();
  for (let i = 0; i < left.length; i++) {
    const row = [];
    for (let j = 0; j < right.length; j++) row.push(attempt(() => join(left[i], right[j])));
    lines.push(i + " " + row.join(" | "));
    lines.push(i + " " + attempt(() => append(left[i], right[(i + round) % right.length])) + " | " + attempt(() => three(left[i], "-", right[i])));
  }
}
lines.push(attempt(() => join("a", Symbol("s"))), attempt(() => join(Symbol("s"), "a")));
lines.push(attempt(() => build(["a", "é", "中", "", "😀", 1, null, "z"])), attempt(() => quote("id", 1)), attempt(() => quote("名", "\"值\"")));

const powers = ["x"];
for (let k = 1; k <= 29; k++) powers.push(join(powers[k - 1], powers[k - 1]));
const big = powers[29];
let almost = powers[0];
for (let k = 1; k <= 28; k++) almost = join(almost, powers[k]);
lines.push("big " + big.length, "almost " + almost.length);
lines.push(attempt(() => join(big, big).length), attempt(() => join(join(big, big), big).length), attempt(() => join(join(big, big), join(big, big)).length), attempt(() => join(join(big, big), join(big, almost)).length), attempt(() => join(join(join(big, big), join(big, almost)), "x").length), attempt(() => join("x", join(join(big, big), join(big, almost))).length), attempt(() => join(join(join(big, big), join(big, almost)), "").length));

const kept = [];
let checksum = 0;
for (let turn = 0; turn < 60000; turn++) {
  const text = join(join("key" + (turn % 7), ":"), turn % 2 ? "value" : "値");
  if (turn % 1000 === 0) kept.push(text);
  if (turn % 20000 === 19999) collect();
  checksum = (checksum + text.length + text.charCodeAt(text.length - 1)) % 1000003;
}
collect();
lines.push("checksum " + checksum, kept.join(","));
let deep = "";
for (let turn = 0; turn < 20000; turn++) deep = turn % 2 ? join(deep, "r") : join("l", deep);
lines.push(show(deep), String(deep.indexOf("lr")));
console.log(lines.join("\n"));
