import { test, expect, describe } from "bun:test";
import { bunRun } from "harness";
import path from "path";

const it = process.env.SMTP_SENDGRID_KEY && process.env.SMTP_SENDGRID_SENDER ? test : test.skip;
describe("nodemailer", () => {
  it("basic smtp", async () => {
    try {
      const info = bunRun(path.join(import.meta.dir, "process-nodemailer-fixture.js"), {
        SMTP_SENDGRID_SENDER: process.env.SMTP_SENDGRID_SENDER as string,
        SMTP_SENDGRID_KEY: process.env.SMTP_SENDGRID_KEY as string,
      });
      expect(info.stdout).toBe("true");
      expect(info.stderr || "").toBe("");
    } catch (err: any) {
      expect(err?.message || err).toBe("");
    }
  }, 10000);
});
