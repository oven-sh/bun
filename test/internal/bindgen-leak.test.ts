import { simpleMemoryLeakChecker } from "harness";
import { bindgen } from "bun:internal-for-testing";

it("returned bun string gets dereferenced", () => {
  const referenceString = bindgen.returnBunString(32 * 1000 * 1000);
  simpleMemoryLeakChecker({
    samples: 20,
    run() {
      expect(bindgen.returnBunString(32 * 1000 * 1000)).toBe(referenceString);
    },
  });
});
