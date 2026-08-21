// Stress half of bun-serve-static: body read via res[method]() *without* first
// touching res.body (exercises the buffered-stream fast path added in #13704).
// Split from the sibling "-access-body" file so each half stays well inside the
// per-file wall clock on a slow runner. Loop sizing and assertions live in runStress.
import { afterAll, beforeAll, describe, test } from "bun:test";
import { isBroken, isMacOS } from "harness";
import { runStress, stressMethods, stressPaths, StressServer } from "./bun-serve-static-helpers";

describe.todoIf(isBroken && isMacOS)("static (stress, don't access .body)", () => {
  let stress: StressServer;

  beforeAll(() => {
    stress = new StressServer();
  });

  afterAll(() => {
    stress.stop();
  });

  describe.each(stressPaths)("%s", path => {
    test.each(stressMethods)("%s", method => runStress(stress, path, false, method));
  });
});
