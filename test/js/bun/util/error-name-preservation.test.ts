// Verifies that user-visible error names, codes, and messages from the
// native error paths are preserved across the per-crate Error enum refactor.
// These pin the exact strings the runtime hands to JS; any drift in a
// crate's `Error::name()` / `#[error("...")]` / errno routing surfaces here.

import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync, readdirSync } from "node:fs";

describe("native error name/code preservation", () => {
  test("fs ENOENT code and syscall survive the errno path", () => {
    let err: any;
    try {
      readFileSync("/this/path/definitely/does/not/exist/anywhere");
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect({ code: err.code, syscall: err.syscall, path: err.path }).toEqual({
      code: "ENOENT",
      syscall: "open",
      path: "/this/path/definitely/does/not/exist/anywhere",
    });
  });

  test("fs ENOTDIR code survives the errno path", () => {
    using dir = tempDir("err-name", { "file.txt": "x" });
    let err: any;
    try {
      readdirSync(`${dir}/file.txt`);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe("ENOTDIR");
  });

  test("fetch connection-refused message is preserved verbatim", async () => {
    // 1 is never listening; IPv4 literal so this is a pure connect error
    // on every platform without touching DNS.
    let err: any;
    try {
      await fetch("http://127.0.0.1:1/");
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    // The WHATWG fetch shape: outer TypeError('fetch failed') with the
    // underlying error as `.cause`. The on_reject match-arm message lives on
    // the cause; the outer error also mirrors `.code` for compatibility.
    expect({
      name: err.name,
      code: err.code,
      message: String(err.message),
      causeCode: err.cause?.code,
      causeMessage: String(err.cause?.message),
    }).toEqual({
      name: "TypeError",
      code: "ECONNREFUSED",
      message: "fetch failed",
      causeCode: "ECONNREFUSED",
      causeMessage: "Unable to connect. Is the computer able to access the url?",
    });
  });
});
