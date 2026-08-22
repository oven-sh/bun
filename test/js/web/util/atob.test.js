import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import os from "node:os";

function expectInvalidCharacters(val) {
  expect(() => atob(val)).toThrow("The string contains invalid characters.");
}

it("atob", () => {
  expect(atob("YQ==")).toBe("a");
  expect(atob("YWI=")).toBe("ab");
  expect(atob("YWJj")).toBe("abc");
  expect(atob("YWJjZA==")).toBe("abcd");
  expect(atob("YWJjZGU=")).toBe("abcde");
  expect(atob("YWJjZGVm")).toBe("abcdef");
  expect(atob("zzzz")).toBe("Ï<ó");
  expect(atob("")).toBe("");
  expect(atob(null)).toBe("ée");
  expect(atob("6ek=")).toBe("éé");
  expect(atob("6ek")).toBe("éé");
  expect(atob("gIE=")).toBe("");
  expect(atob("zz")).toBe("Ï");
  expect(atob("zzz")).toBe("Ï<");
  expect(atob("zzz=")).toBe("Ï<");
  expect(atob(" YQ==")).toBe("a");
  expect(atob("YQ==\u000a")).toBe("a");

  try {
    atob();
  } catch (error) {
    expect(error.name).toBe("TypeError");
  }
  expectInvalidCharacters(undefined);
  expectInvalidCharacters(" abcd===");
  expectInvalidCharacters("abcd=== ");
  expectInvalidCharacters("abcd ===");
  expectInvalidCharacters("тест");
  expectInvalidCharacters("z");
  expectInvalidCharacters("zzz==");
  expectInvalidCharacters("zzz===");
  expectInvalidCharacters("zzz====");
  expectInvalidCharacters("zzz=====");
  expectInvalidCharacters("zzzzz");
  expectInvalidCharacters("z=zz");
  expectInvalidCharacters("=");
  expectInvalidCharacters("==");
  expectInvalidCharacters("===");
  expectInvalidCharacters("====");
  expectInvalidCharacters("=====");
});

it("btoa", () => {
  expect(btoa("a")).toBe("YQ==");
  expect(btoa("ab")).toBe("YWI=");
  expect(btoa("abc")).toBe("YWJj");
  expect(btoa("abcd")).toBe("YWJjZA==");
  expect(btoa("abcde")).toBe("YWJjZGU=");
  expect(btoa("abcdef")).toBe("YWJjZGVm");
  expect(typeof btoa).toBe("function");
  expect(() => btoa()).toThrow("btoa requires 1 argument (a string)");
  var window = "[object Window]";
  expect(btoa("")).toBe("");
  expect(btoa(null)).toBe("bnVsbA==");
  expect(btoa(undefined)).toBe("dW5kZWZpbmVk");
  expect(btoa(window)).toBe("W29iamVjdCBXaW5kb3dd");
  expect(btoa("éé")).toBe("6ek=");
  // check for utf16
  expect(btoa("🧐éé".substring("🧐".length))).toBe("6ek=");
  expect(btoa("\u0080\u0081")).toBe("gIE=");
  expect(btoa(Bun)).toBe(btoa("[object Bun]"));
});

// btoa output lengths above WTF::StringImpl::MaxLength (2^31 - 1) used to trip
// a RELEASE_ASSERT and abort the process instead of throwing. These need real
// multi-GiB peaks, so each case runs in a subprocess and the block skips on
// small machines (same gate as blob-oom.test.ts).
describe.skipIf(os.totalmem() < 10 * 1024 ** 3)("btoa at the 2 GiB string limit", () => {
  // Building and encoding multi-GiB strings is slow under debug/ASAN.
  const timeout = isDebug || isASAN ? 90_000 : undefined;

  it(
    "throws ERR_STRING_TOO_LONG when the output would exceed 2^31 - 1 characters",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          // base64 output = ceil(1610612734 / 3) * 4 = 2147483648 = 2^31
          const input = Buffer.alloc(1610612734, 0x61).toString();
          try {
            console.log(JSON.stringify({ unexpectedLength: btoa(input).length }));
          } catch (e) {
            console.log(JSON.stringify({ name: e.name, code: e.code, message: e.message }));
          }
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual({
        name: "Error",
        code: "ERR_STRING_TOO_LONG",
        message: "Cannot create a string longer than 2147483647 characters",
      });
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  it(
    "still encodes the largest input whose output fits",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          // base64 output = (1610612733 / 3) * 4 = 2147483644 <= 2^31 - 1
          const input = Buffer.alloc(1610612733, 0x61).toString();
          console.log(JSON.stringify({ length: btoa(input).length }));
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(JSON.parse(stdout.trim() || JSON.stringify({ stdout, stderr, exitCode }))).toEqual({ length: 2147483644 });
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});
