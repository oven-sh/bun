// A group that is repeated a fixed number of times and takes no input matches whatever the count is, in literals and in patterns made at run time.
function describe(match) {
  return match === null ? "null" : match.index + ":" + JSON.stringify([...match]);
}

for (const expression of [
  /(?:\b){4000000000}/,
  /(?:){4000000000}b/,
  /(?:^){4000000000}a/,
  /(?:^){4000000000}b/,
  /(?:$){4000000000}/,
  /(?:\B){4000000000}/,
  /(?:(?=b)){4000000000}/,
  /(?:(?=(b))){4000000000}/,
  /(?:(?!a)){4000000000}/,
  /(?:(?<=a)){4000000000}/,
  /(?<=a)(?:\b){4000000000}/,
  /(?<=(?:\b){4000000000}a)b/,
  /(\b){4000000000}/,
  /(?:()){4000000000}b/,
  /(?:(?:\b){4000000000}){4000000000}/,
  /(?:(\b){4000000000}){4000000000}/,
  /(?:(?:(?:$){4000000000}){4000000000}){4000000000}/,
  /(?:(?:(?=[ab])){4000000000}[ab]){2}/,
  /(?:(?:(?:\B){4000000000}){4000000000}|a)/,
  /(?:(\b){4000000000}x|a)/,
  /(?:(?=(a))){4000000000}(?:(?=(b))){4000000000}|ab/,
  /(?:\b){4000000000}/u,
  /(?:\b){4000000000}/v,
  /(?:\b){4000000000}/y,
  /(?:\b){4000000000}?a/,
])
  console.log(String(expression), describe(expression.exec("ab")));

// The counts are not known until the program runs.
const count = 4000000000 + process.argv.length - process.argv.length;
for (const [front, behind, flags] of [
  ["", "", ""],
  ["(?:(?<n>x)|(?<n>y))?", "", ""],
  ["", "(?:(?<n>x)|(?<n>y))?", ""],
  ["", "[\\q{zz|z}]?", "v"],
  ["(?<=^|q)", "", ""],
]) {
  for (const source of [
    "(?:\\b){N}",
    "(?:){N}a",
    "(?:^){N}",
    "(?:$){N}",
    "(?:\\B){N}",
    "(?:(?=(a))){N}",
    "(\\b){N}",
    "(?:(?:\\b){N}){N}",
    "(?:(\\b){N}){N}",
    "(?:(?:(?=[ab])){N}[ab]){2}",
    "(?:(?:(?:\\B){N}){N}|a)",
    "(?:(\\b){N}x|a)",
  ]) {
    const expression = new RegExp(front + source.replaceAll("N", count) + behind, flags);
    console.log(String(expression), describe(expression.exec("ab")));
  }
}

// Behind the groups stands a search that is given up.
const givenUp = new RegExp("(?:(?:\\b){N}){N}(x+x+)+y".replaceAll("N", count));
console.log(String(givenUp), describe(givenUp.exec("x".repeat(40))));
