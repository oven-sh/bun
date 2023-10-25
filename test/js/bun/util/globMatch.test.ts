import { expect, test, describe } from "bun:test";
import { globMatch } from "bun";

describe("globMatch", () => {
  test("single wildcard", () => {
    let pat = "";

    pat = "*";
    expect(globMatch(pat, "foo")).toBeTrue();
    expect(globMatch(pat, "lmao.ts")).toBeTrue();
    expect(globMatch(pat, "")).toBeTrue();
    expect(globMatch(pat, "   ")).toBeTrue();
    expect(globMatch(pat, "*")).toBeTrue();

    pat = "*.ts";
    expect(globMatch(pat, "foo.ts")).toBeTrue();
    expect(globMatch(pat, ".ts")).toBeTrue();
    expect(globMatch(pat, "")).toBeFalse();
    expect(globMatch(pat, "bar.tsx")).toBeFalse();
    expect(globMatch(pat, "foo/bar.ts")).toBeFalse();

    pat = "src/*/*.ts";
    expect(globMatch(pat, "src/foo/bar.ts")).toBeTrue();
    expect(globMatch(pat, "src/bar.ts")).toBeFalse();
  });

  test("double wildcard", () => {
    let pat = "";

    pat = "**";
    expect(globMatch(pat, "")).toBeTrue();
    expect(globMatch(pat, "nice/wow/great/foo.ts")).toBeTrue();

    pat = "foo/**/bar";
    expect(globMatch(pat, "")).toBeFalse();
    expect(globMatch(pat, "foo/lmao/lol/bar")).toBeTrue();
    expect(globMatch(pat, "foo/lmao/lol/haha/wtf/nice/bar")).toBeTrue();
    expect(globMatch(pat, "foo/bar")).toBeFalse();

    pat = "src/**/*.ts";
    expect(globMatch(pat, "src/foo/bar/baz/nice.ts")).toBeTrue();

    pat = "src/foo/*/bar/**/*.ts";
    expect(globMatch(pat, "src/foo/nice/bar/baz/lmao.ts")).toBeTrue();
    expect(globMatch(pat, "src/foo/nice/bar/baz/lmao.ts")).toBeTrue();
  });

  test("braces", () => {
    let pat = "";

    pat = "index.{ts,tsx,js,jsx}";
    expect(globMatch(pat, "index.ts")).toBeTrue();
    expect(globMatch(pat, "index.tsx")).toBeTrue();
    expect(globMatch(pat, "index.js")).toBeTrue();
    expect(globMatch(pat, "index.jsx")).toBeTrue();
    expect(globMatch(pat, "index.jsxxxxxxxx")).toBeFalse();
  });

  test("invalid input", () => {
    expect(
      returnError(() =>
        globMatch(
          // @ts-expect-error
          null,
          "hello",
        ),
      ),
    ).toBeDefined();

    expect(
      returnError(() =>
        globMatch(
          // @ts-expect-error
          true,
          "hello",
        ),
      ),
    ).toBeDefined();

    expect(
      returnError(() =>
        globMatch(
          // @ts-expect-error
          {},
          "hello",
        ),
      ),
    ).toBeDefined();

    expect(
      returnError(() =>
        globMatch(
          "hello",
          // @ts-expect-error
          null,
        ),
      ),
    ).toBeDefined();
    expect(
      returnError(() =>
        globMatch(
          "hello",
          // @ts-expect-error
          true,
        ),
      ),
    ).toBeDefined();

    expect(
      returnError(() =>
        globMatch(
          "hello",
          // @ts-expect-error
          {},
        ),
      ),
    ).toBeDefined();
  });
});

function returnError(cb: () => any): Error | undefined {
  try {
    cb();
  } catch (err) {
    // @ts-expect-error
    return err;
  }
  return undefined;
}
