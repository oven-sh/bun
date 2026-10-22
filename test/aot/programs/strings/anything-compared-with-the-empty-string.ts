const launder = new Function("value", "return value") as <V>(value: V) => V;

class Named {
  name: string;
  nickname: string | undefined;
  note: string | null;
  anything: unknown;
  constructor(name: string, nickname: string | undefined, note: string | null, anything: unknown) {
    this.name = name;
    this.nickname = nickname;
    this.note = note;
    this.anything = anything;
  }
}

const long = "abcdefghijklmnopqrstuvwxyz".repeat(3);
const texts: string[] = [
  "",
  "a",
  " ",
  "\0",
  "ab",
  long,
  long.slice(5, 5),
  long.slice(5, 6),
  long.substring(40),
  long.substring(long.length),
  "é",
  "中",
  "中".slice(1),
  "" + "",
  ["", ""].join(""),
  String(launder("")) + launder(""),
  launder("x") + launder(""),
  launder(long) + launder(long),
  launder("").concat(launder("")),
  " ".trim(),
  "abc".replace("abc", ""),
  String.fromCharCode(),
  new String("").valueOf(),
  `${launder("")}`,
];
const others: unknown[] = [undefined, null, 0, -0, NaN, false, true, 1, 0n, [], [""], {}, new String(""), Symbol.iterator, () => "", { toString: () => "" }];

function ofTypedFields(one: Named): string {
  let said = "";
  said += one.name === "" ? "E" : "n";
  said += one.name !== "" ? "n" : "E";
  said += "" === one.name ? "E" : "n";
  said += one.nickname === "" ? "E" : "n";
  said += one.nickname !== "" ? "n" : "E";
  said += one.note === "" ? "E" : "n";
  said += one.note !== "" ? "n" : "E";
  said += one.anything === "" ? "E" : "n";
  said += one.anything !== "" ? "n" : "E";
  const isEmpty = one.nickname === "";
  const isNot = one.anything !== "";
  said += String(isEmpty) + String(isNot);
  switch (one.nickname) {
    case "":
      said += "|empty";
      break;
    case "a":
      said += "|a";
      break;
    case undefined:
      said += "|undefined";
      break;
    default:
      said += "|other";
  }
  switch (one.anything) {
    case "":
      said += "|empty";
      break;
    case 0:
      said += "|zero";
      break;
    default:
      said += "|other";
  }
  return said;
}

function loosely(value: unknown): string {
  return (value == "" ? "E" : "n") + (value != "" ? "n" : "E") + ("" == value ? "E" : "n");
}

const lines: string[] = [];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < texts.length; i++) {
    const text = launder(texts[i]);
    const one = launder(new Named(text, i % 3 === 0 ? undefined : text, i % 4 === 0 ? null : text, i % 5 === 0 ? i : text));
    const line = i + " " + text.length + " " + ofTypedFields(one) + " " + loosely(text);
    if (round === 2) lines.push(line);
  }
  for (let i = 0; i < others.length; i++) {
    const one = launder(new Named("x", undefined, null, launder(others[i])));
    const line = "other " + i + " " + ofTypedFields(one) + " " + loosely(others[i]);
    if (round === 2) lines.push(line);
  }
}
console.log(lines.join("\n"));
