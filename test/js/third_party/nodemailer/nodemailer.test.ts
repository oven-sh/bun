import { test, expect, describe } from "bun:test";
import { bunRun } from "harness";
import path from "path";

describe("nodemailer", () => {
  test("basic smtp", async () => {
    try {
      const info = bunRun(path.join(import.meta.dir, "process-nodemailer-fixture.js"));
      expect(info.stdout).toBe("true");
      expect(info.stderr || "").toBe("");
    } catch (err: any) {
      expect(err?.message || err).toBe("");
    }
  }, 10000);
});
