import { describe, expect, test } from "bun:test";
import { classifyGalleryVersionState } from "../../../../scripts/build/ci/existence.ts";

// The pipeline existence check and the bake-time probe in machine.ts both
// classify an Azure gallery image version's provisioningState with this one
// function, so what "exists / reuse" means is defined in one place.
describe("classifyGalleryVersionState", () => {
  test("Succeeded is a finished bake: reuse", () => {
    expect(classifyGalleryVersionState("Succeeded")).toBe("reuse");
  });

  test("Updating is a LIVE version mid metadata write: reuse, never re-bake", () => {
    // robobun stamping a `last-used` demand tag holds a 27-region version in
    // "Updating" for ~2 minutes while it stays fully launchable. Treating it
    // as anything but reusable makes the pipeline emit a spurious bake for a
    // live image, and makes the bake-time probe throw on an unrelated push.
    expect(classifyGalleryVersionState("Updating")).toBe("reuse");
  });

  test("Creating is a real bake in flight: not reusable, do not race it", () => {
    expect(classifyGalleryVersionState("Creating")).toBe("creating");
  });

  test("dead states re-bake", () => {
    for (const state of ["Failed", "Canceled", "Deleting", "Migrating", undefined, ""]) {
      expect(classifyGalleryVersionState(state)).toBe("rebake");
    }
  });
});
