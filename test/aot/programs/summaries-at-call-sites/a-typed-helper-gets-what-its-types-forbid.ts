// Callers that prove what they pass stand beside callers that pass what the types forbid, through `any`. Each caller gets the answer that JavaScript gives, and the one does not spoil the other.
class Meter {
  constructor(public length: number) {}
}
class Word {
  constructor(public letters: string) {}
}
function lengthOf(meter: Meter): number {
  return meter.length;
}
function longest(meters: Meter[]): Meter {
  let best = meters[0];
  for (const meter of meters) if (meter.length > best.length) best = meter;
  return best;
}
function rename(word: Word, letters: string): Word {
  word.letters = letters;
  return word;
}
function twice(callback: (meter: Meter) => number, meter: Meter): number {
  return callback(meter) + callback(meter);
}
const loose: any = { lengthOf, longest, rename, twice };
const lines: string[] = [];
for (let i = 0; i < 4; i++) {
  lines.push(String(lengthOf(new Meter(i))));
  lines.push(String(loose.lengthOf("four")), String(loose.lengthOf([1, 2, 3])), String(loose.lengthOf({ length: "own" })), String(loose.lengthOf(new Word("w"))));
  lines.push(String(longest([new Meter(1), new Meter(i)]).length));
  lines.push(String(loose.longest(["a", "bbb", "cc"])), String(loose.longest([[1], [1, 2]]).length), String(loose.longest([{ length: 2, tag: "t" }]).tag));
  lines.push(rename(new Word("a"), "b" + i).letters);
  lines.push(String(loose.rename({ letters: 1, other: 2 }, 5).letters), String(loose.rename(new Meter(1), "x").letters), String(Object.keys(loose.rename({}, "y"))));
  lines.push(String(twice(lengthOf, new Meter(i))), String(loose.twice((x: any) => x, "ab")), String(loose.twice(lengthOf, "abc")), String(twice(m => m.length * 2, new Meter(i))));
  try {
    loose.lengthOf(undefined);
  } catch (error) {
    lines.push((error as Error).constructor.name);
  }
}
console.log(lines.join("\n"));
