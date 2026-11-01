// One store by key, in the test file and in a package, for objects of the files between. First into fields that are there, what is no object: the short road takes that and remembers
// it. Then what fits the field and what does not, also into objects that do not have the field yet. What is remembered about an object of another program must not be read in the
// numbers of this one: where it was, this ended the process.
import { expect } from "bun:test";
import { test } from "../../harness/declare";
import { set as setInPackage } from "one-site";
import { makers } from "../src/fields-not-yet-there";
function setHere(object: Record<string, unknown>, key: string, value: unknown) {
  object[key] = value;
  return object;
}
for (const [where, set] of [["here", setHere], ["in a package", setInPackage]] as const) {
  test("stores " + where, () => {
    let h = 7;
    const mix = (text: string) => { for (let c = 0; c < text.length; c++) h = (Math.imul(h, 31) + text.charCodeAt(c)) | 0; };
    for (let m = 0; m < makers.length; m++) {
      const make = makers[m];
      const other = makers[(m + 1) % makers.length](-1).inner;
      for (let i = -6; i < 0; i++) {
        const o = make(i);
        set(o, "inner", null); set(o, "b", "v" + i); set(o, "level", i);
        mix(JSON.stringify(o));
      }
      for (let i = -6; i < 8; i++) {
        const o = make(i), own = make(-1).inner;
        set(o, "inner", i % 3 === 0 ? own : i % 3 === 1 ? other : { y: i });
        set(o, "level", i % 4 === 0 ? "text" : i % 4 === 1 ? i + 0.5 : i % 4 === 2 ? own : i);
        set(o, "b", i % 2 ? i : "s");
        mix(JSON.stringify(o) + Object.keys(o).join());
      }
    }
    console.log("RESULT|63|stores " + where + "|" + h + "|-");
    expect(typeof h).toBe("number");
  });
}
