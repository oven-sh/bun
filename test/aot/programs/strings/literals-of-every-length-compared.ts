// In loops of 1,000 turns, so that the comparisons are compiled for speed, literals of 0 to 33 characters are compared with the equal text, texts that differ in the first, the middle or the last unit, shorter and longer ones, each as a flat string, a rope, a slice, a 16-bit string with the same content and a slice of 16-bit text, and in an `any` position also with numbers, null, objects with toString and other values: ===, !==, ==, switch, startsWith and endsWith. Every line prints what plain Bun prints.
// STATISTIC: StringLiteralsComparedInPlace >= 32
const never = Date.now() < 0;
const hidden = (text: string): string => (never ? text + "!" : text);
const flat = (text: string): string => hidden(text.split("").join(""));
const wideFlat = (text: string): string => JSON.parse(JSON.stringify([text, "\u2603"]))[0];

type Prepared = {
  flat: string[];
  left: string[];
  right: string[];
  padded: string[];
  wide: string[];
  widePadded: string[];
  others: any[];
  subjects: number;
  values: number;
};

function changedAt(text: string, at: number, unit: number): string {
  return text.slice(0, at) + String.fromCharCode(unit) + text.slice(at + 1);
}
function prepare(literal: string): Prepared {
  const length = literal.length;
  const texts = [literal, literal + "!", "!" + literal, literal + literal, ""];
  if (length > 0) {
    texts.push(changedAt(literal, 0, 35), changedAt(literal, length >> 1, 35), changedAt(literal, length - 1, 35), literal.slice(0, -1), literal.slice(1));
    texts.push(changedAt(literal, 0, literal.charCodeAt(0) ^ 0x100), changedAt(literal, length - 1, literal.charCodeAt(length - 1) ^ 0x100), changedAt(literal, length - 1, literal.charCodeAt(length - 1) ^ 0x80));
  }
  const others: any[] = [0, 7, NaN, null, undefined, true, false, { toString: () => literal }, { valueOf: () => literal }, [literal], new String(literal), Symbol(literal), 10n];
  return {
    flat: texts.map(text => flat(text)),
    left: texts.map(text => flat(text.slice(0, text.length >> 1))),
    right: texts.map(text => flat(text.slice(text.length >> 1))),
    padded: texts.map(text => flat("<" + text + ">")),
    wide: texts.map(text => wideFlat(text)),
    widePadded: texts.map(text => flat("\u2603" + text + "\u2603")),
    others,
    subjects: texts.length * 5,
    values: texts.length * 5 + others.length,
  };
}
function subjectAt(prepared: Prepared, turn: number): string {
  const which = turn % prepared.subjects;
  const text = (which / 5) | 0;
  switch (which % 5) {
    case 0:
      return prepared.flat[text];
    case 1:
      return prepared.left[text] + prepared.right[text];
    case 2:
      return prepared.padded[text].slice(1, -1);
    case 3:
      return prepared.wide[text];
    default:
      return prepared.widePadded[text].slice(1, -1);
  }
}
function valueAt(prepared: Prepared, turn: number): any {
  const which = turn % prepared.values;
  return which < prepared.subjects ? subjectAt(prepared, which) : prepared.others[which - prepared.subjects];
}

function compareAsciiOf0(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "") bits |= 1;
    if (text !== "") bits |= 2;
    if (text.startsWith("")) bits |= 4;
    if (text.endsWith("")) bits |= 8;
    if (text === "#") bits |= 16;
    if (text === "!") bits |= 32;
    switch (text) { case "": bits += 64; break; case "##": bits += 128; break; case "!": bits += 192; break; }
    if (value === "") bits |= 512;
    if (value !== "") bits |= 1024;
    if (value == "") bits |= 2048;
    switch (value) { case "": bits += 4096; break; case "##": bits += 8192; break; case "!": bits += 12288; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf1(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "k") bits |= 1;
    if (text !== "k") bits |= 2;
    if (text.startsWith("k")) bits |= 4;
    if (text.endsWith("k")) bits |= 8;
    if (text === "#") bits |= 16;
    if (text === "k!") bits |= 32;
    switch (text) { case "k": bits += 64; break; case "#": bits += 128; break; case "k!": bits += 192; break; case "": bits += 256; break; }
    if (value === "k") bits |= 512;
    if (value !== "k") bits |= 1024;
    if (value == "k") bits |= 2048;
    switch (value) { case "k": bits += 4096; break; case "#": bits += 8192; break; case "k!": bits += 12288; break; case "": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf2(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kL") bits |= 1;
    if (text !== "kL") bits |= 2;
    if (text.startsWith("kL")) bits |= 4;
    if (text.endsWith("kL")) bits |= 8;
    if (text === "k#") bits |= 16;
    if (text === "kL!") bits |= 32;
    switch (text) { case "kL": bits += 64; break; case "#L": bits += 128; break; case "kL!": bits += 192; break; case "k": bits += 256; break; }
    if (value === "kL") bits |= 512;
    if (value !== "kL") bits |= 1024;
    if (value == "kL") bits |= 2048;
    switch (value) { case "kL": bits += 4096; break; case "#L": bits += 8192; break; case "kL!": bits += 12288; break; case "k": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf3(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLm") bits |= 1;
    if (text !== "kLm") bits |= 2;
    if (text.startsWith("kLm")) bits |= 4;
    if (text.endsWith("kLm")) bits |= 8;
    if (text === "kL#") bits |= 16;
    if (text === "kLm!") bits |= 32;
    switch (text) { case "kLm": bits += 64; break; case "#Lm": bits += 128; break; case "kLm!": bits += 192; break; case "kL": bits += 256; break; }
    if (value === "kLm") bits |= 512;
    if (value !== "kLm") bits |= 1024;
    if (value == "kLm") bits |= 2048;
    switch (value) { case "kLm": bits += 4096; break; case "#Lm": bits += 8192; break; case "kLm!": bits += 12288; break; case "kL": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf4(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmN") bits |= 1;
    if (text !== "kLmN") bits |= 2;
    if (text.startsWith("kLmN")) bits |= 4;
    if (text.endsWith("kLmN")) bits |= 8;
    if (text === "kLm#") bits |= 16;
    if (text === "kLmN!") bits |= 32;
    switch (text) { case "kLmN": bits += 64; break; case "#LmN": bits += 128; break; case "kLmN!": bits += 192; break; case "kLm": bits += 256; break; }
    if (value === "kLmN") bits |= 512;
    if (value !== "kLmN") bits |= 1024;
    if (value == "kLmN") bits |= 2048;
    switch (value) { case "kLmN": bits += 4096; break; case "#LmN": bits += 8192; break; case "kLmN!": bits += 12288; break; case "kLm": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf5(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNo") bits |= 1;
    if (text !== "kLmNo") bits |= 2;
    if (text.startsWith("kLmNo")) bits |= 4;
    if (text.endsWith("kLmNo")) bits |= 8;
    if (text === "kLmN#") bits |= 16;
    if (text === "kLmNo!") bits |= 32;
    switch (text) { case "kLmNo": bits += 64; break; case "#LmNo": bits += 128; break; case "kLmNo!": bits += 192; break; case "kLmN": bits += 256; break; }
    if (value === "kLmNo") bits |= 512;
    if (value !== "kLmNo") bits |= 1024;
    if (value == "kLmNo") bits |= 2048;
    switch (value) { case "kLmNo": bits += 4096; break; case "#LmNo": bits += 8192; break; case "kLmNo!": bits += 12288; break; case "kLmN": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf6(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoP") bits |= 1;
    if (text !== "kLmNoP") bits |= 2;
    if (text.startsWith("kLmNoP")) bits |= 4;
    if (text.endsWith("kLmNoP")) bits |= 8;
    if (text === "kLmNo#") bits |= 16;
    if (text === "kLmNoP!") bits |= 32;
    switch (text) { case "kLmNoP": bits += 64; break; case "#LmNoP": bits += 128; break; case "kLmNoP!": bits += 192; break; case "kLmNo": bits += 256; break; }
    if (value === "kLmNoP") bits |= 512;
    if (value !== "kLmNoP") bits |= 1024;
    if (value == "kLmNoP") bits |= 2048;
    switch (value) { case "kLmNoP": bits += 4096; break; case "#LmNoP": bits += 8192; break; case "kLmNoP!": bits += 12288; break; case "kLmNo": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf7(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPq") bits |= 1;
    if (text !== "kLmNoPq") bits |= 2;
    if (text.startsWith("kLmNoPq")) bits |= 4;
    if (text.endsWith("kLmNoPq")) bits |= 8;
    if (text === "kLmNoP#") bits |= 16;
    if (text === "kLmNoPq!") bits |= 32;
    switch (text) { case "kLmNoPq": bits += 64; break; case "#LmNoPq": bits += 128; break; case "kLmNoPq!": bits += 192; break; case "kLmNoP": bits += 256; break; }
    if (value === "kLmNoPq") bits |= 512;
    if (value !== "kLmNoPq") bits |= 1024;
    if (value == "kLmNoPq") bits |= 2048;
    switch (value) { case "kLmNoPq": bits += 4096; break; case "#LmNoPq": bits += 8192; break; case "kLmNoPq!": bits += 12288; break; case "kLmNoP": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf8(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqR") bits |= 1;
    if (text !== "kLmNoPqR") bits |= 2;
    if (text.startsWith("kLmNoPqR")) bits |= 4;
    if (text.endsWith("kLmNoPqR")) bits |= 8;
    if (text === "kLmNoPq#") bits |= 16;
    if (text === "kLmNoPqR!") bits |= 32;
    switch (text) { case "kLmNoPqR": bits += 64; break; case "#LmNoPqR": bits += 128; break; case "kLmNoPqR!": bits += 192; break; case "kLmNoPq": bits += 256; break; }
    if (value === "kLmNoPqR") bits |= 512;
    if (value !== "kLmNoPqR") bits |= 1024;
    if (value == "kLmNoPqR") bits |= 2048;
    switch (value) { case "kLmNoPqR": bits += 4096; break; case "#LmNoPqR": bits += 8192; break; case "kLmNoPqR!": bits += 12288; break; case "kLmNoPq": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf9(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRs") bits |= 1;
    if (text !== "kLmNoPqRs") bits |= 2;
    if (text.startsWith("kLmNoPqRs")) bits |= 4;
    if (text.endsWith("kLmNoPqRs")) bits |= 8;
    if (text === "kLmNoPqR#") bits |= 16;
    if (text === "kLmNoPqRs!") bits |= 32;
    switch (text) { case "kLmNoPqRs": bits += 64; break; case "#LmNoPqRs": bits += 128; break; case "kLmNoPqRs!": bits += 192; break; case "kLmNoPqR": bits += 256; break; }
    if (value === "kLmNoPqRs") bits |= 512;
    if (value !== "kLmNoPqRs") bits |= 1024;
    if (value == "kLmNoPqRs") bits |= 2048;
    switch (value) { case "kLmNoPqRs": bits += 4096; break; case "#LmNoPqRs": bits += 8192; break; case "kLmNoPqRs!": bits += 12288; break; case "kLmNoPqR": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf10(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsT") bits |= 1;
    if (text !== "kLmNoPqRsT") bits |= 2;
    if (text.startsWith("kLmNoPqRsT")) bits |= 4;
    if (text.endsWith("kLmNoPqRsT")) bits |= 8;
    if (text === "kLmNoPqRs#") bits |= 16;
    if (text === "kLmNoPqRsT!") bits |= 32;
    switch (text) { case "kLmNoPqRsT": bits += 64; break; case "#LmNoPqRsT": bits += 128; break; case "kLmNoPqRsT!": bits += 192; break; case "kLmNoPqRs": bits += 256; break; }
    if (value === "kLmNoPqRsT") bits |= 512;
    if (value !== "kLmNoPqRsT") bits |= 1024;
    if (value == "kLmNoPqRsT") bits |= 2048;
    switch (value) { case "kLmNoPqRsT": bits += 4096; break; case "#LmNoPqRsT": bits += 8192; break; case "kLmNoPqRsT!": bits += 12288; break; case "kLmNoPqRs": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf11(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTu") bits |= 1;
    if (text !== "kLmNoPqRsTu") bits |= 2;
    if (text.startsWith("kLmNoPqRsTu")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTu")) bits |= 8;
    if (text === "kLmNoPqRsT#") bits |= 16;
    if (text === "kLmNoPqRsTu!") bits |= 32;
    switch (text) { case "kLmNoPqRsTu": bits += 64; break; case "#LmNoPqRsTu": bits += 128; break; case "kLmNoPqRsTu!": bits += 192; break; case "kLmNoPqRsT": bits += 256; break; }
    if (value === "kLmNoPqRsTu") bits |= 512;
    if (value !== "kLmNoPqRsTu") bits |= 1024;
    if (value == "kLmNoPqRsTu") bits |= 2048;
    switch (value) { case "kLmNoPqRsTu": bits += 4096; break; case "#LmNoPqRsTu": bits += 8192; break; case "kLmNoPqRsTu!": bits += 12288; break; case "kLmNoPqRsT": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf12(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuV") bits |= 1;
    if (text !== "kLmNoPqRsTuV") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuV")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuV")) bits |= 8;
    if (text === "kLmNoPqRsTu#") bits |= 16;
    if (text === "kLmNoPqRsTuV!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuV": bits += 64; break; case "#LmNoPqRsTuV": bits += 128; break; case "kLmNoPqRsTuV!": bits += 192; break; case "kLmNoPqRsTu": bits += 256; break; }
    if (value === "kLmNoPqRsTuV") bits |= 512;
    if (value !== "kLmNoPqRsTuV") bits |= 1024;
    if (value == "kLmNoPqRsTuV") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuV": bits += 4096; break; case "#LmNoPqRsTuV": bits += 8192; break; case "kLmNoPqRsTuV!": bits += 12288; break; case "kLmNoPqRsTu": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf13(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVw") bits |= 1;
    if (text !== "kLmNoPqRsTuVw") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVw")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVw")) bits |= 8;
    if (text === "kLmNoPqRsTuV#") bits |= 16;
    if (text === "kLmNoPqRsTuVw!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVw": bits += 64; break; case "#LmNoPqRsTuVw": bits += 128; break; case "kLmNoPqRsTuVw!": bits += 192; break; case "kLmNoPqRsTuV": bits += 256; break; }
    if (value === "kLmNoPqRsTuVw") bits |= 512;
    if (value !== "kLmNoPqRsTuVw") bits |= 1024;
    if (value == "kLmNoPqRsTuVw") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVw": bits += 4096; break; case "#LmNoPqRsTuVw": bits += 8192; break; case "kLmNoPqRsTuVw!": bits += 12288; break; case "kLmNoPqRsTuV": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf14(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwX") bits |= 1;
    if (text !== "kLmNoPqRsTuVwX") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwX")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwX")) bits |= 8;
    if (text === "kLmNoPqRsTuVw#") bits |= 16;
    if (text === "kLmNoPqRsTuVwX!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwX": bits += 64; break; case "#LmNoPqRsTuVwX": bits += 128; break; case "kLmNoPqRsTuVwX!": bits += 192; break; case "kLmNoPqRsTuVw": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwX") bits |= 512;
    if (value !== "kLmNoPqRsTuVwX") bits |= 1024;
    if (value == "kLmNoPqRsTuVwX") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwX": bits += 4096; break; case "#LmNoPqRsTuVwX": bits += 8192; break; case "kLmNoPqRsTuVwX!": bits += 12288; break; case "kLmNoPqRsTuVw": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf15(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXy") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXy") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXy")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXy")) bits |= 8;
    if (text === "kLmNoPqRsTuVwX#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXy!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXy": bits += 64; break; case "#LmNoPqRsTuVwXy": bits += 128; break; case "kLmNoPqRsTuVwXy!": bits += 192; break; case "kLmNoPqRsTuVwX": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXy") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXy") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXy") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXy": bits += 4096; break; case "#LmNoPqRsTuVwXy": bits += 8192; break; case "kLmNoPqRsTuVwXy!": bits += 12288; break; case "kLmNoPqRsTuVwX": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf16(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZ") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZ") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZ")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZ")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXy#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZ!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZ": bits += 64; break; case "#LmNoPqRsTuVwXyZ": bits += 128; break; case "kLmNoPqRsTuVwXyZ!": bits += 192; break; case "kLmNoPqRsTuVwXy": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZ") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZ") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZ") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZ": bits += 4096; break; case "#LmNoPqRsTuVwXyZ": bits += 8192; break; case "kLmNoPqRsTuVwXyZ!": bits += 12288; break; case "kLmNoPqRsTuVwXy": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf17(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZa") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZa") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZa")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZa")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZ#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZa!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZa": bits += 64; break; case "#LmNoPqRsTuVwXyZa": bits += 128; break; case "kLmNoPqRsTuVwXyZa!": bits += 192; break; case "kLmNoPqRsTuVwXyZ": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZa") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZa") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZa") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZa": bits += 4096; break; case "#LmNoPqRsTuVwXyZa": bits += 8192; break; case "kLmNoPqRsTuVwXyZa!": bits += 12288; break; case "kLmNoPqRsTuVwXyZ": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf18(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaB") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaB") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaB")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaB")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZa#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaB!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaB": bits += 64; break; case "#LmNoPqRsTuVwXyZaB": bits += 128; break; case "kLmNoPqRsTuVwXyZaB!": bits += 192; break; case "kLmNoPqRsTuVwXyZa": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaB") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaB") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaB") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaB": bits += 4096; break; case "#LmNoPqRsTuVwXyZaB": bits += 8192; break; case "kLmNoPqRsTuVwXyZaB!": bits += 12288; break; case "kLmNoPqRsTuVwXyZa": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf19(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBc") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBc") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBc")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBc")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaB#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBc!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBc": bits += 64; break; case "#LmNoPqRsTuVwXyZaBc": bits += 128; break; case "kLmNoPqRsTuVwXyZaBc!": bits += 192; break; case "kLmNoPqRsTuVwXyZaB": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBc") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBc") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBc") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBc": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBc": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBc!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaB": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf20(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcD") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcD") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcD")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcD")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBc#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcD!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcD": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcD": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcD!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBc": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcD") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcD") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcD") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcD": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcD": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcD!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBc": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf21(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDe") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDe") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDe")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDe")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcD#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDe!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDe": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDe": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDe!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcD": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDe") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDe") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDe") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDe": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDe": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDe!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcD": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf22(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeF") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeF") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeF")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeF")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDe#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeF!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeF": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeF": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeF!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDe": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeF") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeF") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeF") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeF": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeF": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeF!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDe": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf23(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFg") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFg") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFg")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFg")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeF#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFg!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFg": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFg": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFg!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeF": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFg") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFg") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFg") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFg": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFg": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFg!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeF": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf24(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgH") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgH") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgH")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgH")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFg#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgH!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgH": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgH": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgH!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFg": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgH") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgH") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgH") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgH": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgH": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgH!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFg": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf25(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHi") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHi") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHi")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHi")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgH#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHi!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHi": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHi": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHi!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgH": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHi") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHi") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHi") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHi": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHi": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHi!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgH": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf26(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHi#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHi": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHiJ") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHiJ") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgHi": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf27(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ0") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ0")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ0")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ0": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ0") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHiJ0") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ0": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf28(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ01") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ01") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ01")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ01")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ01!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ01": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHiJ01") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ01") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHiJ01") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ01": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf29(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ012") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ012") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ012")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ012")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ01#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ012!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ012": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHiJ012") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ012") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHiJ012") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ012": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf30(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ0123")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ0123")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ012#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ0123": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ0123": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf31(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ01234")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ01234")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ01234": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ01234": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf32(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ012345")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ012345")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ012345": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ012345": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ01234": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareAsciiOf33(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456") bits |= 1;
    if (text !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456") bits |= 2;
    if (text.startsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456")) bits |= 4;
    if (text.endsWith("kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456")) bits |= 8;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345#") bits |= 16;
    if (text === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456!") bits |= 32;
    switch (text) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456": bits += 64; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ0123456": bits += 128; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456!": bits += 192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345": bits += 256; break; }
    if (value === "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456") bits |= 512;
    if (value !== "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456") bits |= 1024;
    if (value == "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456") bits |= 2048;
    switch (value) { case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456": bits += 4096; break; case "#LmNoPqRsTuVwXyZaBcDeFgHiJ0123456": bits += 8192; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456!": bits += 12288; break; case "kLmNoPqRsTuVwXyZaBcDeFgHiJ012345": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareLatin1Of1(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u00e9") bits |= 1;
    if (text !== "\u00e9") bits |= 2;
    if (text.startsWith("\u00e9")) bits |= 4;
    if (text.endsWith("\u00e9")) bits |= 8;
    if (text === "#") bits |= 16;
    if (text === "\u00e9!") bits |= 32;
    switch (text) { case "\u00e9": bits += 64; break; case "#": bits += 128; break; case "\u00e9!": bits += 192; break; case "": bits += 256; break; }
    if (value === "\u00e9") bits |= 512;
    if (value !== "\u00e9") bits |= 1024;
    if (value == "\u00e9") bits |= 2048;
    switch (value) { case "\u00e9": bits += 4096; break; case "#": bits += 8192; break; case "\u00e9!": bits += 12288; break; case "": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareLatin1Of2(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u00e9\u00ff") bits |= 1;
    if (text !== "\u00e9\u00ff") bits |= 2;
    if (text.startsWith("\u00e9\u00ff")) bits |= 4;
    if (text.endsWith("\u00e9\u00ff")) bits |= 8;
    if (text === "\u00e9#") bits |= 16;
    if (text === "\u00e9\u00ff!") bits |= 32;
    switch (text) { case "\u00e9\u00ff": bits += 64; break; case "#\u00ff": bits += 128; break; case "\u00e9\u00ff!": bits += 192; break; case "\u00e9": bits += 256; break; }
    if (value === "\u00e9\u00ff") bits |= 512;
    if (value !== "\u00e9\u00ff") bits |= 1024;
    if (value == "\u00e9\u00ff") bits |= 2048;
    switch (value) { case "\u00e9\u00ff": bits += 4096; break; case "#\u00ff": bits += 8192; break; case "\u00e9\u00ff!": bits += 12288; break; case "\u00e9": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareLatin1Of3(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u00e9\u00ff\u0080") bits |= 1;
    if (text !== "\u00e9\u00ff\u0080") bits |= 2;
    if (text.startsWith("\u00e9\u00ff\u0080")) bits |= 4;
    if (text.endsWith("\u00e9\u00ff\u0080")) bits |= 8;
    if (text === "\u00e9\u00ff#") bits |= 16;
    if (text === "\u00e9\u00ff\u0080!") bits |= 32;
    switch (text) { case "\u00e9\u00ff\u0080": bits += 64; break; case "#\u00ff\u0080": bits += 128; break; case "\u00e9\u00ff\u0080!": bits += 192; break; case "\u00e9\u00ff": bits += 256; break; }
    if (value === "\u00e9\u00ff\u0080") bits |= 512;
    if (value !== "\u00e9\u00ff\u0080") bits |= 1024;
    if (value == "\u00e9\u00ff\u0080") bits |= 2048;
    switch (value) { case "\u00e9\u00ff\u0080": bits += 4096; break; case "#\u00ff\u0080": bits += 8192; break; case "\u00e9\u00ff\u0080!": bits += 12288; break; case "\u00e9\u00ff": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareLatin1Of4(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u00e9\u00ff\u0080\u00c0") bits |= 1;
    if (text !== "\u00e9\u00ff\u0080\u00c0") bits |= 2;
    if (text.startsWith("\u00e9\u00ff\u0080\u00c0")) bits |= 4;
    if (text.endsWith("\u00e9\u00ff\u0080\u00c0")) bits |= 8;
    if (text === "\u00e9\u00ff\u0080#") bits |= 16;
    if (text === "\u00e9\u00ff\u0080\u00c0!") bits |= 32;
    switch (text) { case "\u00e9\u00ff\u0080\u00c0": bits += 64; break; case "#\u00ff\u0080\u00c0": bits += 128; break; case "\u00e9\u00ff\u0080\u00c0!": bits += 192; break; case "\u00e9\u00ff\u0080": bits += 256; break; }
    if (value === "\u00e9\u00ff\u0080\u00c0") bits |= 512;
    if (value !== "\u00e9\u00ff\u0080\u00c0") bits |= 1024;
    if (value == "\u00e9\u00ff\u0080\u00c0") bits |= 2048;
    switch (value) { case "\u00e9\u00ff\u0080\u00c0": bits += 4096; break; case "#\u00ff\u0080\u00c0": bits += 8192; break; case "\u00e9\u00ff\u0080\u00c0!": bits += 12288; break; case "\u00e9\u00ff\u0080": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareLatin1Of7(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0") bits |= 1;
    if (text !== "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0") bits |= 2;
    if (text.startsWith("\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0")) bits |= 4;
    if (text.endsWith("\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0")) bits |= 8;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df#") bits |= 16;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0!") bits |= 32;
    switch (text) { case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0": bits += 64; break; case "#\u00ff\u0080\u00c0\u00f1\u00df\u00a0": bits += 128; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0!": bits += 192; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df": bits += 256; break; }
    if (value === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0") bits |= 512;
    if (value !== "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0") bits |= 1024;
    if (value == "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0") bits |= 2048;
    switch (value) { case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0": bits += 4096; break; case "#\u00ff\u0080\u00c0\u00f1\u00df\u00a0": bits += 8192; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0!": bits += 12288; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareLatin1Of8(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5") bits |= 1;
    if (text !== "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5") bits |= 2;
    if (text.startsWith("\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5")) bits |= 4;
    if (text.endsWith("\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5")) bits |= 8;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0#") bits |= 16;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5!") bits |= 32;
    switch (text) { case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5": bits += 64; break; case "#\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5": bits += 128; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5!": bits += 192; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0": bits += 256; break; }
    if (value === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5") bits |= 512;
    if (value !== "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5") bits |= 1024;
    if (value == "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5") bits |= 2048;
    switch (value) { case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5": bits += 4096; break; case "#\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5": bits += 8192; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5!": bits += 12288; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareLatin1Of9(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe") bits |= 1;
    if (text !== "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe") bits |= 2;
    if (text.startsWith("\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe")) bits |= 4;
    if (text.endsWith("\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe")) bits |= 8;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5#") bits |= 16;
    if (text === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe!") bits |= 32;
    switch (text) { case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe": bits += 64; break; case "#\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe": bits += 128; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe!": bits += 192; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5": bits += 256; break; }
    if (value === "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe") bits |= 512;
    if (value !== "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe") bits |= 1024;
    if (value == "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe") bits |= 2048;
    switch (value) { case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe": bits += 4096; break; case "#\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe": bits += 8192; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe!": bits += 12288; break; case "\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareWideOf1(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u0141") bits |= 1;
    if (text !== "\u0141") bits |= 2;
    if (text.startsWith("\u0141")) bits |= 4;
    if (text.endsWith("\u0141")) bits |= 8;
    if (text === "#") bits |= 16;
    if (text === "\u0141!") bits |= 32;
    switch (text) { case "\u0141": bits += 64; break; case "#": bits += 128; break; case "\u0141!": bits += 192; break; case "": bits += 256; break; }
    if (value === "\u0141") bits |= 512;
    if (value !== "\u0141") bits |= 1024;
    if (value == "\u0141") bits |= 2048;
    switch (value) { case "\u0141": bits += 4096; break; case "#": bits += 8192; break; case "\u0141!": bits += 12288; break; case "": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareWideOf2(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u0141\u0142") bits |= 1;
    if (text !== "\u0141\u0142") bits |= 2;
    if (text.startsWith("\u0141\u0142")) bits |= 4;
    if (text.endsWith("\u0141\u0142")) bits |= 8;
    if (text === "\u0141#") bits |= 16;
    if (text === "\u0141\u0142!") bits |= 32;
    switch (text) { case "\u0141\u0142": bits += 64; break; case "#\u0142": bits += 128; break; case "\u0141\u0142!": bits += 192; break; case "\u0141": bits += 256; break; }
    if (value === "\u0141\u0142") bits |= 512;
    if (value !== "\u0141\u0142") bits |= 1024;
    if (value == "\u0141\u0142") bits |= 2048;
    switch (value) { case "\u0141\u0142": bits += 4096; break; case "#\u0142": bits += 8192; break; case "\u0141\u0142!": bits += 12288; break; case "\u0141": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareWideOf3(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u0141\u0142\u0143") bits |= 1;
    if (text !== "\u0141\u0142\u0143") bits |= 2;
    if (text.startsWith("\u0141\u0142\u0143")) bits |= 4;
    if (text.endsWith("\u0141\u0142\u0143")) bits |= 8;
    if (text === "\u0141\u0142#") bits |= 16;
    if (text === "\u0141\u0142\u0143!") bits |= 32;
    switch (text) { case "\u0141\u0142\u0143": bits += 64; break; case "#\u0142\u0143": bits += 128; break; case "\u0141\u0142\u0143!": bits += 192; break; case "\u0141\u0142": bits += 256; break; }
    if (value === "\u0141\u0142\u0143") bits |= 512;
    if (value !== "\u0141\u0142\u0143") bits |= 1024;
    if (value == "\u0141\u0142\u0143") bits |= 2048;
    switch (value) { case "\u0141\u0142\u0143": bits += 4096; break; case "#\u0142\u0143": bits += 8192; break; case "\u0141\u0142\u0143!": bits += 12288; break; case "\u0141\u0142": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareWideOf4(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u0141\u0142\u0143\u0144") bits |= 1;
    if (text !== "\u0141\u0142\u0143\u0144") bits |= 2;
    if (text.startsWith("\u0141\u0142\u0143\u0144")) bits |= 4;
    if (text.endsWith("\u0141\u0142\u0143\u0144")) bits |= 8;
    if (text === "\u0141\u0142\u0143#") bits |= 16;
    if (text === "\u0141\u0142\u0143\u0144!") bits |= 32;
    switch (text) { case "\u0141\u0142\u0143\u0144": bits += 64; break; case "#\u0142\u0143\u0144": bits += 128; break; case "\u0141\u0142\u0143\u0144!": bits += 192; break; case "\u0141\u0142\u0143": bits += 256; break; }
    if (value === "\u0141\u0142\u0143\u0144") bits |= 512;
    if (value !== "\u0141\u0142\u0143\u0144") bits |= 1024;
    if (value == "\u0141\u0142\u0143\u0144") bits |= 2048;
    switch (value) { case "\u0141\u0142\u0143\u0144": bits += 4096; break; case "#\u0142\u0143\u0144": bits += 8192; break; case "\u0141\u0142\u0143\u0144!": bits += 12288; break; case "\u0141\u0142\u0143": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareWideOf5(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u0141\u0142\u0143\u0144\u0145") bits |= 1;
    if (text !== "\u0141\u0142\u0143\u0144\u0145") bits |= 2;
    if (text.startsWith("\u0141\u0142\u0143\u0144\u0145")) bits |= 4;
    if (text.endsWith("\u0141\u0142\u0143\u0144\u0145")) bits |= 8;
    if (text === "\u0141\u0142\u0143\u0144#") bits |= 16;
    if (text === "\u0141\u0142\u0143\u0144\u0145!") bits |= 32;
    switch (text) { case "\u0141\u0142\u0143\u0144\u0145": bits += 64; break; case "#\u0142\u0143\u0144\u0145": bits += 128; break; case "\u0141\u0142\u0143\u0144\u0145!": bits += 192; break; case "\u0141\u0142\u0143\u0144": bits += 256; break; }
    if (value === "\u0141\u0142\u0143\u0144\u0145") bits |= 512;
    if (value !== "\u0141\u0142\u0143\u0144\u0145") bits |= 1024;
    if (value == "\u0141\u0142\u0143\u0144\u0145") bits |= 2048;
    switch (value) { case "\u0141\u0142\u0143\u0144\u0145": bits += 4096; break; case "#\u0142\u0143\u0144\u0145": bits += 8192; break; case "\u0141\u0142\u0143\u0144\u0145!": bits += 12288; break; case "\u0141\u0142\u0143\u0144": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareWideOf9(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149") bits |= 1;
    if (text !== "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149") bits |= 2;
    if (text.startsWith("\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149")) bits |= 4;
    if (text.endsWith("\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149")) bits |= 8;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148#") bits |= 16;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149!") bits |= 32;
    switch (text) { case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149": bits += 64; break; case "#\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149": bits += 128; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149!": bits += 192; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148": bits += 256; break; }
    if (value === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149") bits |= 512;
    if (value !== "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149") bits |= 1024;
    if (value == "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149") bits |= 2048;
    switch (value) { case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149": bits += 4096; break; case "#\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149": bits += 8192; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149!": bits += 12288; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareWideOf32(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160") bits |= 1;
    if (text !== "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160") bits |= 2;
    if (text.startsWith("\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160")) bits |= 4;
    if (text.endsWith("\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160")) bits |= 8;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f#") bits |= 16;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160!") bits |= 32;
    switch (text) { case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160": bits += 64; break; case "#\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160": bits += 128; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160!": bits += 192; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f": bits += 256; break; }
    if (value === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160") bits |= 512;
    if (value !== "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160") bits |= 1024;
    if (value == "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160") bits |= 2048;
    switch (value) { case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160": bits += 4096; break; case "#\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160": bits += 8192; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160!": bits += 12288; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}
function compareWideOf33(prepared: Prepared): string {
  let answers = "";
  let hash = 0;
  for (let turn = 0; turn < 1000; turn++) {
    const text = subjectAt(prepared, turn);
    const value = valueAt(prepared, turn);
    let bits = 0;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161") bits |= 1;
    if (text !== "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161") bits |= 2;
    if (text.startsWith("\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161")) bits |= 4;
    if (text.endsWith("\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161")) bits |= 8;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160#") bits |= 16;
    if (text === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161!") bits |= 32;
    switch (text) { case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161": bits += 64; break; case "#\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161": bits += 128; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161!": bits += 192; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160": bits += 256; break; }
    if (value === "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161") bits |= 512;
    if (value !== "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161") bits |= 1024;
    if (value == "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161") bits |= 2048;
    switch (value) { case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161": bits += 4096; break; case "#\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161": bits += 8192; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161!": bits += 12288; break; case "\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160": bits += 16384; break; }
    if (turn < prepared.values) answers += " " + bits.toString(36);
    hash = (Math.imul(hash, 31) + bits) | 0;
  }
  return answers + " hash " + hash;
}

const ascii = hidden("kLmNoPqRsTuVwXyZaBcDeFgHiJ0123456");
const latin1 = hidden("\u00e9\u00ff\u0080\u00c0\u00f1\u00df\u00a0\u00b5\u00fe");
const wide = hidden("\u0141\u0142\u0143\u0144\u0145\u0146\u0147\u0148\u0149\u014a\u014b\u014c\u014d\u014e\u014f\u0150\u0151\u0152\u0153\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161");
const preparedAscii: Prepared[] = [];
for (let length = 0; length <= 33; length++) preparedAscii.push(prepare(ascii.slice(0, length)));
const preparedLatin1: Prepared[] = [];
for (let length = 0; length <= 9; length++) preparedLatin1.push(prepare(latin1.slice(0, length)));
const preparedWide: Prepared[] = [];
for (let length = 0; length <= 33; length++) preparedWide.push(prepare(wide.slice(0, length)));
for (let round = 0; round < 2; round++) {
  console.log("round " + round + ", ASCII 0:" + compareAsciiOf0(preparedAscii[0]));
  console.log("round " + round + ", ASCII 1:" + compareAsciiOf1(preparedAscii[1]));
  console.log("round " + round + ", ASCII 2:" + compareAsciiOf2(preparedAscii[2]));
  console.log("round " + round + ", ASCII 3:" + compareAsciiOf3(preparedAscii[3]));
  console.log("round " + round + ", ASCII 4:" + compareAsciiOf4(preparedAscii[4]));
  console.log("round " + round + ", ASCII 5:" + compareAsciiOf5(preparedAscii[5]));
  console.log("round " + round + ", ASCII 6:" + compareAsciiOf6(preparedAscii[6]));
  console.log("round " + round + ", ASCII 7:" + compareAsciiOf7(preparedAscii[7]));
  console.log("round " + round + ", ASCII 8:" + compareAsciiOf8(preparedAscii[8]));
  console.log("round " + round + ", ASCII 9:" + compareAsciiOf9(preparedAscii[9]));
  console.log("round " + round + ", ASCII 10:" + compareAsciiOf10(preparedAscii[10]));
  console.log("round " + round + ", ASCII 11:" + compareAsciiOf11(preparedAscii[11]));
  console.log("round " + round + ", ASCII 12:" + compareAsciiOf12(preparedAscii[12]));
  console.log("round " + round + ", ASCII 13:" + compareAsciiOf13(preparedAscii[13]));
  console.log("round " + round + ", ASCII 14:" + compareAsciiOf14(preparedAscii[14]));
  console.log("round " + round + ", ASCII 15:" + compareAsciiOf15(preparedAscii[15]));
  console.log("round " + round + ", ASCII 16:" + compareAsciiOf16(preparedAscii[16]));
  console.log("round " + round + ", ASCII 17:" + compareAsciiOf17(preparedAscii[17]));
  console.log("round " + round + ", ASCII 18:" + compareAsciiOf18(preparedAscii[18]));
  console.log("round " + round + ", ASCII 19:" + compareAsciiOf19(preparedAscii[19]));
  console.log("round " + round + ", ASCII 20:" + compareAsciiOf20(preparedAscii[20]));
  console.log("round " + round + ", ASCII 21:" + compareAsciiOf21(preparedAscii[21]));
  console.log("round " + round + ", ASCII 22:" + compareAsciiOf22(preparedAscii[22]));
  console.log("round " + round + ", ASCII 23:" + compareAsciiOf23(preparedAscii[23]));
  console.log("round " + round + ", ASCII 24:" + compareAsciiOf24(preparedAscii[24]));
  console.log("round " + round + ", ASCII 25:" + compareAsciiOf25(preparedAscii[25]));
  console.log("round " + round + ", ASCII 26:" + compareAsciiOf26(preparedAscii[26]));
  console.log("round " + round + ", ASCII 27:" + compareAsciiOf27(preparedAscii[27]));
  console.log("round " + round + ", ASCII 28:" + compareAsciiOf28(preparedAscii[28]));
  console.log("round " + round + ", ASCII 29:" + compareAsciiOf29(preparedAscii[29]));
  console.log("round " + round + ", ASCII 30:" + compareAsciiOf30(preparedAscii[30]));
  console.log("round " + round + ", ASCII 31:" + compareAsciiOf31(preparedAscii[31]));
  console.log("round " + round + ", ASCII 32:" + compareAsciiOf32(preparedAscii[32]));
  console.log("round " + round + ", ASCII 33:" + compareAsciiOf33(preparedAscii[33]));
  console.log("round " + round + ", Latin-1 1:" + compareLatin1Of1(preparedLatin1[1]));
  console.log("round " + round + ", Latin-1 2:" + compareLatin1Of2(preparedLatin1[2]));
  console.log("round " + round + ", Latin-1 3:" + compareLatin1Of3(preparedLatin1[3]));
  console.log("round " + round + ", Latin-1 4:" + compareLatin1Of4(preparedLatin1[4]));
  console.log("round " + round + ", Latin-1 7:" + compareLatin1Of7(preparedLatin1[7]));
  console.log("round " + round + ", Latin-1 8:" + compareLatin1Of8(preparedLatin1[8]));
  console.log("round " + round + ", Latin-1 9:" + compareLatin1Of9(preparedLatin1[9]));
  console.log("round " + round + ", 16-bit 1:" + compareWideOf1(preparedWide[1]));
  console.log("round " + round + ", 16-bit 2:" + compareWideOf2(preparedWide[2]));
  console.log("round " + round + ", 16-bit 3:" + compareWideOf3(preparedWide[3]));
  console.log("round " + round + ", 16-bit 4:" + compareWideOf4(preparedWide[4]));
  console.log("round " + round + ", 16-bit 5:" + compareWideOf5(preparedWide[5]));
  console.log("round " + round + ", 16-bit 9:" + compareWideOf9(preparedWide[9]));
  console.log("round " + round + ", 16-bit 32:" + compareWideOf32(preparedWide[32]));
  console.log("round " + round + ", 16-bit 33:" + compareWideOf33(preparedWide[33]));
}
