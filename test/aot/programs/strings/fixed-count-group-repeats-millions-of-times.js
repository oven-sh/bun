// A group repeated a fixed number of times takes millions of turns, in a literal and in a pattern made at run time, and the alternative behind it is tried when a turn is missing.
function lengths(match) {
  return match === null
    ? "null"
    : match.index + ":" + match.map(part => (part === undefined ? "-" : part.length)).join(",");
}

const forms = [
  ["(?:ab){", "}|a"],
  ["(ab){", "}|a"],
  ["(?:(a)(b)){", "}|a"],
  ["(?:(?:ab){2}){", "}|a", 2],
  ["x?(?:ab){", "}$|a"],
  ["(?=(?:ab){", "})a|b"],
];
for (const turns of [2097152, 8388610]) {
  const text = "ab".repeat(turns);
  for (const [head, tail, inner = 1] of forms) {
    const count = turns / inner;
    if (!Number.isInteger(count)) continue;
    console.log(
      head + count + tail,
      lengths(new RegExp(head + count + tail).exec(text)),
      lengths(new RegExp(head + (count + 1) + tail).exec(text)),
    );
  }
}

const text = "ab".repeat(8388700);
console.log(lengths(/(?:ab){8388700}|a/.exec(text)), lengths(/(?:ab){8388701}|a/.exec(text)));
console.log(lengths(/(ab){8388700}|a/.exec(text)), lengths(/(ab){8388701}|a/.exec(text)));
