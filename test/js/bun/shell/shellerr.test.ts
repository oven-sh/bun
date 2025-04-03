import { $, type ShellError } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "path";
import type { Kind } from "./fixtures/error";

describe("shell-error", () => {
  const fixture = join(__dirname, "fixtures", "error");
  const kinds: [kind: Kind, expected: string | ((s: string) => void)][] = [
    ["ascii-at-end", "<truncated from 512 bytes> " + "a".repeat(256)],
    ["2-byte-sequence-at-end", "<truncated from 512 bytes> " + "a".repeat(254) + "£"],
    ["3-byte-sequence-at-end", "<truncated from 512 bytes> " + "a".repeat(253) + "⛄"],
    ["4-byte-sequence-at-end", "<truncated from 512 bytes> " + "a".repeat(252) + "𒀖"],
    ["continuation-byte-at-end", "<truncated from 512 bytes> " + "a".repeat(254)],
    ["random", (s: string) => s.startsWith("<truncated from 512 bytes> ")],
    ["no-over-rollback-3byte", "<truncated from 512 bytes> " + "a".repeat(252)],
    ["no-over-rollback-4byte", "<truncated from 512 bytes> " + "a".repeat(252)],
    ["trim-newlines", "<truncated from 512 bytes> " + "a".repeat(252)],
    ["utf-8-in-the-middle", "<truncated from 512 bytes> " + "£".repeat(127)],
  ];

  for (const [kind, expected] of kinds) {
    test(kind, async () => {
      try {
        await $`bun ${fixture} ${kind}`.throws(true).quiet();
      } catch (err_) {
        let err = err_ as ShellError;
        expect(err.exitCode).toBe(1);
        if (typeof expected === "function") {
          expected(err.message);
        } else {
          expect(err.message).toEqual(expected);
        }
        return;
      }
      expect.unreachable();
    });
  }
});
