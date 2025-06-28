import { describe, expect, test } from "bun:test";
import { bunRun, getSecret } from "harness";
import path from "path";

const smtpPass = getSecret("SMTP_MAILGUN_PASS");
const smtpUser = getSecret("SMTP_MAILGUN_USER");
const smtpToFrom = getSecret("SMTP_MAILGUN_TO_FROM");

describe.skipIf(!smtpPass || !smtpUser || !smtpToFrom)("nodemailer", () => {
  test("basic smtp", async () => {
    try {
      const info = bunRun(path.join(import.meta.dir, "nodemailer.fixture.js"), {
        SMTP_MAILGUN_USER: process.env.SMTP_MAILGUN_USER as string,
        SMTP_MAILGUN_PASS: process.env.SMTP_MAILGUN_PASS as string,
        SMTP_MAILGUN_TO_FROM: process.env.SMTP_MAILGUN_TO_FROM as string,
      });
      expect(info.stdout).toBe("true");
      expect(info.stderr || "").toBe("");
    } catch (err: any) {
      expect(err?.message || err).toBe("");
    }
  }, 10000);
});
