import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { buildCounted, countScript } from "./harness/counted-run";
import { slot } from "./run-programs";
import { test } from "./supported";

// A class with static fields is evaluated inside a function that the code around it makes and calls at one place.
const forms: Record<string, string> = {
  "a function that returns a class, under the classes that are read": `
    class Base { id = 1; }
    const Timed = (Parent) => class extends Parent { static kind = "timed"; static limit = 3; };
    const Tagged = (Parent) => class extends Parent { static kind = "tagged"; };
    class A extends Timed(Base) {}
    class B extends Tagged(Timed(Base)) {}
    const work = () => A.kind.length + B.kind.length + A.limit + B.limit;
    const expected = 17;`,
  "a function that is called where it is written": `
    const K = (function () { class Inner { static kind = "inner"; static limit = 3; } return Inner; })();
    const L = (() => { class Other extends K { static own = 4; } return Other; })();
    const work = () => K.kind.length + L.kind.length + K.limit + L.own;
    const expected = 17;`,
};

test.each(Object.keys(forms))(
  "a static field is read without a look under its name: %s",
  form =>
    slot(async () => {
      using dir = tempDir("aot-static-fields-inside-a-call", {
        "rounds.js": `${forms[form]}
    function round(index) { return work() + (index & 1); }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round(index) - (index & 1);
    console.log(sum === units * expected ? "ok" : "no");
`,
      });
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n");
      expect(work.accessesByName).toBe(0);
      expect(work.runtimeOperations).toEqual({});
    }),
  300_000,
);
