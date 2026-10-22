// A string built only to become a part of a longer string, where the longer string passes 2^31 - 1 characters:
// the RangeError comes from the same concatenation as in plain Bun, with the same side effects before it, and is caught by the same catch.
const log: string[] = [];
function doubled(times: number): string {
  let text = "x";
  for (let i = 0; i < times; i++) text = text + text;
  return text;
}
const big = doubled(30);
const half = doubled(29);

function noisy(label: string, text: string): string {
  log.push(label);
  return text;
}
function attempt(label: string, run: () => string): void {
  log.length = 0;
  let outcome: string;
  try {
    const result = run();
    outcome = result.length < 20 ? result : "length " + result.length;
  } catch (error) {
    outcome = (error as Error).name + ": " + (error as Error).message;
  }
  console.log(label, outcome, log.join(","));
}

function nothingAfterArm(first: string, text: string, times: number): string {
  let out = first;
  for (let i = 0; i < times; i++) out += "<" + (i & 1 ? text + "x" : "off") + ">";
  return out;
}

function callAfterArm(first: string, text: string, times: number): string {
  let out = first;
  for (let i = 0; i < times; i++) out += "<" + (i & 1 ? text + "x" : "off") + noisy("after " + i, ">");
  return out;
}

function conversionAfterArm(first: string, text: string, values: (string | undefined | number)[]): string {
  let out = first;
  for (let i = 0; i < values.length; i++) out += `<${i & 1 ? text + "x" : "off"}|${values[i]}>`;
  return out;
}

function objectConvertedAfterArm(first: string, text: string, times: number): string {
  let out = first;
  for (let i = 0; i < times; i++) {
    const noisyObject = { toString() { log.push("converted " + i); return "o"; } };
    out += `<${i & 1 ? text + "x" : "off"}|${noisyObject}>`;
  }
  return out;
}

function objectConvertedInArm(first: string, text: string, times: number): string {
  let out = first;
  for (let i = 0; i < times; i++) {
    const noisyObject = { toString() { log.push("converted " + i); return "o"; } };
    out += "<" + (i & 1 ? text + noisyObject : "off") + ">";
  }
  return out;
}

function callInArm(first: string, text: string, times: number): string {
  let out = first;
  for (let i = 0; i < times; i++) out += "<" + (i & 1 ? noisy("arm " + i, text) + "x" : "off") + ">";
  return out;
}

function callInInnerLoop(first: string, text: string, times: number): string {
  let out = first;
  for (let i = 0; i < 2; i++) {
    let row = "";
    for (let j = 0; j < times; j++) row += noisy("cell " + i + j, text);
    out += "[" + row + "]";
  }
  return out;
}

function storeInInnerLoop(first: string, text: string, times: number, seen: number[]): string {
  let out = first;
  for (let i = 0; i < 2; i++) {
    let row = "";
    for (let j = 0; j < times; j++) {
      row += text;
      seen[0] = i * 10 + j;
    }
    out += "[" + row + "]";
  }
  return out;
}

function leavesAfterArm(first: string, text: string, leaveAt: number): string {
  let out = first;
  for (let i = 0; i < 3; i++) {
    const label = i & 1 ? text + "x" : "off";
    if (i === leaveAt) return "left at " + i;
    out += "<" + label + ">";
  }
  return out;
}

function skipsAfterArm(first: string, text: string, skipAt: number): string {
  let out = first;
  for (let i = 0; i < 3; i++) {
    const label = i & 1 ? text + "x" : "off";
    if (i === skipAt) continue;
    out += "<" + label + ">";
  }
  return out;
}

function armInItsOwnTry(first: string, text: string, times: number): string {
  let out = first;
  for (let i = 0; i < times; i++) {
    let label: string;
    try {
      label = i & 1 ? text + "x" : "off";
    } catch {
      label = "caught";
      log.push("caught in the arm " + i);
    }
    out += "<" + label + ">";
  }
  return out;
}

function counterSeenByCatch(first: string, text: string, times: number): string {
  let out = first;
  let j = 0;
  try {
    for (let i = 0; i < 2; i++) {
      let row = "";
      for (j = 0; j < times; j++) row += text;
      out += "[" + row + "]";
    }
  } catch (error) {
    return (error as Error).name + " at " + j;
  }
  return out;
}

const seen = [-1];
attempt("nothing after the arm, fits", () => nothingAfterArm(half, half, 2));
attempt("nothing after the arm", () => nothingAfterArm(big, big, 2));
attempt("a call after the arm, fits", () => callAfterArm(half, half, 2));
attempt("a call after the arm", () => callAfterArm(big, big, 2));
attempt("a conversion after the arm, fits", () => conversionAfterArm(half, half, [1, undefined]));
attempt("a conversion after the arm", () => conversionAfterArm(big, big, [1, undefined]));
attempt("an object converted after the arm", () => objectConvertedAfterArm(big, big, 2));
attempt("an object converted in the arm, fits", () => objectConvertedInArm(half, half, 2));
attempt("an object converted in the arm", () => objectConvertedInArm(big, big, 2));
attempt("a call in the arm", () => callInArm(big, big, 2));
attempt("a call in the inner loop, fits", () => callInInnerLoop("a", "b", 2));
attempt("a call in the inner loop", () => callInInnerLoop(big, half, 2));
attempt("a store in the inner loop", () => storeInInnerLoop(big, half, 2, seen) + seen[0]);
console.log("stored", seen[0]);
attempt("leaves after the arm", () => leavesAfterArm(big, big, 1));
attempt("does not leave", () => leavesAfterArm(big, big, 5));
attempt("skips after the arm", () => skipsAfterArm(big, big, 1));
attempt("the arm in its own try", () => armInItsOwnTry(big, big, 2));
attempt("the counter seen by the catch", () => counterSeenByCatch(big, half, 2));
attempt("after all that", () => callAfterArm("a", "b", 3));
