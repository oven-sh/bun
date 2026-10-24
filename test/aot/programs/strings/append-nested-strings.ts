// A string that is built only to become a part of a longer string: the arms of a conditional, the string of an inner loop, a conditional inside an arm.
// Each function has a neighbor in which building it in place could be seen: the longer string is read in between, an object is converted in front of it, an arm throws.
const log: string[] = [];

function armsOfConditional(names: string[], extra: string): string {
  let out = "";
  for (let i = 0; i < names.length; i++) out += `<li class="${i & 1 ? "a " + extra + " b" : "off"}">${names[i]}</li>`;
  return out;
}

function conditionalIsLastPart(names: string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) out += i ? "," + names[i] : names[i];
  return out;
}

function stringOfInnerLoop(rows: string[][]): string {
  let out = "<table>";
  for (const cells of rows) {
    let row = "";
    for (const cell of cells) row += "<td>" + cell + "</td>";
    out += "<tr>" + row + "</tr>";
  }
  return out + "</table>";
}

function twoConditionals(names: string[], first: boolean, second: boolean): string {
  let out = "";
  for (const name of names) out += `<${first ? "x-" + name : "div"}|${name.length}|${second ? name + "!" : "none"}>`;
  return out;
}

function conditionalInsideArm(names: string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) out += i % 3 ? "[" + (i % 2 ? "odd " + names[i] : "even") + "]" : "third";
  return out;
}

function partsOfEveryKind(values: (number | boolean | null | undefined | bigint | string)[]): string {
  let out = "";
  for (let i = 0; i < values.length; i++) out += `${i}:${values[i]}:${i & 1 ? values[i] + "/" + i : "-"};`;
  return out;
}

function armReadsLongerString(names: string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) out += "<" + (i & 1 ? "at " + out.length : "off") + ">";
  return out;
}

function laterPartReadsLongerString(names: string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) out += "<" + (i & 1 ? "a " + names[i] : "off") + "|" + out.length + ">";
  return out;
}

function objectInFront(names: string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    const noisy = { toString() { log.push("converted " + i); return "o" + i; } };
    out += `${noisy}${i & 1 ? (log.push("arm " + i), "a " + names[i]) : "off"};`;
  }
  return out;
}

function armThrows(names: string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    try {
      out += "<" + (i % 3 === 2 ? "bad " + fail(names[i]) : "ok " + names[i]) + ">";
    } catch (error) {
      out += "(" + (error as Error).message + ")";
    }
  }
  return out;
}

function fail(name: string): string {
  throw new Error("no " + name);
}

function laterPartThrows(names: string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    try {
      out += "<" + (i & 1 ? "a " + names[i] : "off") + "|" + (i % 3 === 2 ? fail(names[i]) : names[i]) + ">";
    } catch {
      out += "?";
    }
  }
  return out;
}

function beginsAgainInInnerLoop(rows: string[][]): string {
  let out = "";
  for (const cells of rows) {
    let row = "";
    for (const cell of cells) {
      if (cell === "reset") row = "z";
      row += cell;
    }
    out += "[" + row + "]";
  }
  return out;
}

function carriedBesideLongerString(names: string[]): string {
  let out = "";
  let previous = "x";
  for (const name of names) {
    out += "<" + previous + ">";
    previous = "y" + name;
  }
  return out + previous;
}

function nestedStringReadTwice(names: string[]): string {
  let out = "";
  let longest = "";
  for (let i = 0; i < names.length; i++) {
    const label = i & 1 ? "a " + names[i] : "off";
    out += label;
    if (label.length > longest.length) longest = label;
  }
  return out + "|" + longest;
}

function leavesLoopInArm(names: string[]): string {
  let out = "";
  for (let i = 0; i < names.length; i++) {
    let label: string;
    if (names[i] === "stop") break;
    else if (i & 1) label = "a " + names[i];
    else label = "off";
    out += "<" + label + ">";
  }
  return out;
}

const names = ["alpha", "beta", "gamma", "delta", "épsilon", "ζήτα", "eta"];
const rows = [["a", "b"], [], ["c"], ["d", "reset", "e", "f"], ["ж", "reset"]];
for (let round = 0; round < 3; round++) {
  console.log(armsOfConditional(names, "c" + round));
  console.log(armsOfConditional([], "none"));
  console.log(conditionalIsLastPart(names));
  console.log(stringOfInnerLoop(rows));
  console.log(twoConditionals(names, round === 0, round === 1));
  console.log(conditionalInsideArm(names));
  console.log(partsOfEveryKind([1, -0, 1.5, NaN, true, null, undefined, 12n, "s", 1e21]));
  console.log(armReadsLongerString(names));
  console.log(laterPartReadsLongerString(names));
  console.log(objectInFront(names.slice(0, 3)), log.splice(0).join(","));
  console.log(armThrows(names));
  console.log(laterPartThrows(names));
  console.log(beginsAgainInInnerLoop(rows));
  console.log(carriedBesideLongerString(names));
  console.log(nestedStringReadTwice(names));
  console.log(leavesLoopInArm(["one", "two", "three", "stop", "four"]));
}
