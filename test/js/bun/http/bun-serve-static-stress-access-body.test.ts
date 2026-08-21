// Stress half of bun-serve-static: body read via res[method]() *after* touching
// res.body (materialises a ReadableStream before the buffered-read fast path).
// Split from the sibling "-no-body" file so each half stays well inside the
// per-file wall clock on a slow runner. Loop sizing and assertions live in runStress.
import { afterAll, beforeAll, describe, test } from "bun:test";
import { isBroken, isMacOS } from "harness";
import { runStress, stressMethods, stressPaths, StressServer } from "./bun-serve-static-helpers";

describe.todoIf(isBroken && isMacOS)("static (stress, access .body)", () => {
  let stress: StressServer;

  beforeAll(() => {
    stress = new StressServer();
  });

  afterAll(() => {
    stress.stop();
  });

  describe.each(stressPaths)("%s", path => {
    test.each(stressMethods)("%s", method => runStress(stress, path, true, method));
  });
});
