import { test, expect } from "bun:test";
import * as lib from "./lib";

// Every call from one image into the other notes which image ran below it. Far more calls are nested here than there is room for at first,
// and they are left by returns, by throws through all of them, and by throws that one of them catches.
function down(depth: number): number { return depth ? 1 + lib.call(() => down(depth - 1)) : 0; }
function downAndThrow(depth: number): number { if (!depth) throw new Error("bottom"); return 1 + lib.call(() => downAndThrow(depth - 1)); }
function downAndTheyThrow(depth: number): number { return depth ? 1 + lib.call(() => downAndTheyThrow(depth - 1)) : lib.thrower("theirs"); }
function caughtEvery(depth: number, step: number): string | number {
  if (!depth) throw new Error("at " + step);
  return depth % step ? lib.call(() => caughtEvery(depth - 1, step)) : lib.tryCall(() => caughtEvery(depth - 1, step));
}
// What an operation finds through the image that runs: a literal of mine, a name of mine.
function ofMyImage(text: string) { const match = /m(i+)ne-(\d+)/.exec(text)!; const record = { onlyHere: match[1], count: Number(match[2]) }; return record.onlyHere + record.count; }

test("n01 a thousand calls nested, and left by returns", () => { for (let turn = 0; turn < 3; turn++) { expect(down(1000)).toBe(1000); expect(ofMyImage("miine-" + turn)).toBe("ii" + turn); } });
test("n02 I throw through all of them", () => { for (let turn = 0; turn < 3; turn++) { expect(() => downAndThrow(900)).toThrow("bottom"); expect(ofMyImage("mine-" + turn)).toBe("i" + turn); expect(down(200)).toBe(200); } });
test("n03 they throw through all of them", () => { for (let turn = 0; turn < 3; turn++) { expect(() => downAndTheyThrow(900)).toThrow("theirs"); expect(ofMyImage("mine-" + turn)).toBe("i" + turn); expect(lib.makeNested().list).toEqual(["x", "y"]); } });
test("n04 they catch it on the way", () => { for (const step of [1, 2, 7, 64, 65, 300]) { expect(caughtEvery(600, step)).toBe("caught:at " + step); expect(ofMyImage("miiine-" + step)).toBe("iii" + step); expect(down(100)).toBe(100); } });
test("n05 the stack ends in the middle of them", () => {
  function forever(): number { return 1 + lib.call(forever); }
  for (let turn = 0; turn < 2; turn++) { expect(forever).toThrow(RangeError); expect(ofMyImage("mine-" + turn)).toBe("i" + turn); expect(down(500)).toBe(500); }
});
test("n06 awaits between them", async () => {
  async function later(depth: number): Promise<number> { await null; return depth ? 1 + (await lib.call(() => later(depth - 1))) : 0; }
  expect(await Promise.all([later(150), later(90), later(1)])).toEqual([150, 90, 1]);
  expect(ofMyImage("mine-6")).toBe("i6");
});
