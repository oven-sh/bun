// A string is appended to in a try and in its catch or finally, and something throws before, between and after the appends.
function checksum(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.length + ":" + sum + ":" + text.slice(0, 16) + ".." + text.slice(-16);
}
function piece(i: number): string {
  if (i % 7 === 3) throw new Error("piece " + i);
  return "n" + i + ";";
}
function check(i: number): void {
  if (i % 5 === 2) throw new RangeError("check " + i);
}

function catchAppends(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += piece(i);
    } catch (e) {
      text += "T";
    }
  }
  return text;
}
function nothingThrows(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += "n" + i + ";";
    } catch (e) {
      text += "T";
    }
  }
  return text;
}
function throwsAfterTheAppend(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += "n" + i + ";";
      check(i);
    } catch (e) {
      text += "T";
    }
  }
  return text;
}
function throwsBetweenAppends(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += "a";
      check(i);
      text += i;
      check(i + 1);
      text += piece(i);
      check(i + 2);
      text += "z";
    } catch (e) {
      text += "<" + (e as Error).message + ">";
    }
  }
  return text;
}
function throwsInTheMiddleOfOneAppend(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += "a" + i + piece(i) + "b" + piece(i + 1) + "c";
    } catch (e) {
      text += "T";
    }
  }
  return text;
}
function finallyAppends(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      try {
        text += piece(i);
      } finally {
        text += "F";
      }
    } catch (e) {
      text += "O";
    }
  }
  return text;
}
function catchAndFinallyAppend(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += piece(i);
      check(i);
    } catch (e) {
      text += "T";
    } finally {
      text += "F";
    }
  }
  return text;
}
function nestedTries(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      try {
        text += piece(i);
        check(i);
      } catch (e) {
        text += "I";
        check(i + 1);
        throw e;
      }
    } catch (e) {
      text += "O";
    }
  }
  return text;
}
function loopInsideTheTry(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i += 4) {
    try {
      for (let j = 0; j < 4; j++) {
        text += piece(i + j);
        check(i + j);
      }
    } catch (e) {
      text += "T";
    }
  }
  return text;
}
function templateLiterals(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text = `${text}${piece(i)}!`;
    } catch (e) {
      text = `${text}T`;
    }
  }
  return text;
}
function concatMethod(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text = text.concat(piece(i), "!");
    } catch (e) {
      text = text.concat("T");
    }
  }
  return text;
}
function fieldOfAnObject(turns: number): string {
  const holder = { text: "" };
  for (let i = 0; i < turns; i++) {
    try {
      holder.text += piece(i);
      check(i);
    } catch (e) {
      holder.text += "T";
    }
  }
  return holder.text;
}
function catchReadsTheString(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += piece(i);
      check(i);
    } catch (e) {
      text += "[" + text.length + text.charAt(text.length - 1) + "]";
    }
  }
  return text;
}
function catchReturnsTheString(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += "n" + i;
      if (i === turns - 2) throw 1;
      text += ";";
    } catch (e) {
      return text;
    }
  }
  return text + "end";
}
function continueAndBreak(turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += piece(i);
      if (i % 3 === 0) continue;
      check(i);
      text += "z";
    } catch (e) {
      text += "T";
      if (i > turns - 4) break;
    }
  }
  return text;
}
function twoStrings(turns: number): string {
  let first = "",
    second = "";
  for (let i = 0; i < turns; i++) {
    try {
      first += piece(i);
      second += piece(i + 1);
      check(i);
    } catch (e) {
      first += "T";
      second += "U";
    }
  }
  return first + "|" + second;
}
function* yields(turns: number): Generator<number, string, void> {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += piece(i);
      if (i % 4 === 0) yield i;
      check(i);
    } catch (e) {
      text += "T";
    }
  }
  return text;
}
function generator(turns: number): string {
  const steps = yields(turns);
  let sum = 0;
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value + sum;
    sum += step.value;
  }
}
async function awaits(turns: number): Promise<string> {
  let text = "";
  for (let i = 0; i < turns; i++) {
    try {
      text += piece(i);
      if (i % 4 === 0) await null;
      check(i);
    } catch (e) {
      text += "T";
    }
  }
  return text;
}

const forms = [
  catchAppends,
  nothingThrows,
  throwsAfterTheAppend,
  throwsBetweenAppends,
  throwsInTheMiddleOfOneAppend,
  finallyAppends,
  catchAndFinallyAppend,
  nestedTries,
  loopInsideTheTry,
  templateLiterals,
  concatMethod,
  fieldOfAnObject,
  catchReadsTheString,
  catchReturnsTheString,
  continueAndBreak,
  twoStrings,
  generator,
];
for (const form of forms) for (const turns of [0, 1, 4, 40, 3000]) console.log(form.name, turns, checksum(form(turns)));
for (const turns of [0, 1, 4, 40, 3000]) console.log("awaits", turns, checksum(await awaits(turns)));
