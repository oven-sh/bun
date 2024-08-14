import { test, expect, describe } from "bun:test";
import { bunRun, getSecret } from "harness";
import path from "path";

const smtpKey = getSecret("SMTP_SENDGRID_KEY");
const smtpSender = getSecret("SMTP_SENDGRID_SENDER");

describe.skipIf(!smtpKey || !smtpSender)("nodemailer", () => {
  test("basic smtp", async () => {
    try {
      const info = bunRun(path.join(import.meta.dir, "nodemailer.fixture.js"), {
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
