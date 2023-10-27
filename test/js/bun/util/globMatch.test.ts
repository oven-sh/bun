import { expect, test, describe } from "bun:test";
import { Glob } from "bun";

describe("globMatch", () => {
  test("single wildcard", () => {
    let glob: Glob;

    glob = new Glob("*");
    expect(glob.match("foo")).toBeTrue();
    expect(glob.match("lmao.ts")).toBeTrue();
    expect(glob.match("")).toBeTrue();
    expect(glob.match("   ")).toBeTrue();
    expect(glob.match("*")).toBeTrue();

    glob = new Glob("*.ts");
    expect(glob.match("foo.ts")).toBeTrue();
    expect(glob.match(".ts")).toBeTrue();
    expect(glob.match("")).toBeFalse();
    expect(glob.match("bar.tsx")).toBeFalse();
    expect(glob.match("foo/bar.ts")).toBeFalse();
    expect(glob.match("foo/bar/baz.ts")).toBeFalse();

    glob = new Glob("src/*/*.ts");
    expect(glob.match("src/foo/bar.ts")).toBeTrue();
    expect(glob.match("src/bar.ts")).toBeFalse();
  });

  test("double wildcard", () => {
    let glob: Glob;

    glob = new Glob("**");
    expect(glob.match("")).toBeTrue();
    expect(glob.match("nice/wow/great/foo.ts")).toBeTrue();

    glob = new Glob("foo/**/bar");
    expect(glob.match("")).toBeFalse();
    expect(glob.match("foo/lmao/lol/bar")).toBeTrue();
    expect(glob.match("foo/lmao/lol/haha/wtf/nice/bar")).toBeTrue();
    expect(glob.match("foo/bar")).toBeTrue();

    glob = new Glob("src/**/*.ts");
    expect(glob.match("src/foo/bar/baz/nice.ts")).toBeTrue();

    glob = new Glob("src/foo/*/bar/**/*.ts");
    expect(glob.match("src/foo/nice/bar/baz/lmao.ts")).toBeTrue();
    expect(glob.match("src/foo/nice/bar/baz/lmao.ts")).toBeTrue();
  });

  test("braces", () => {
    let glob: Glob;

    glob = new Glob("index.{ts,tsx,js,jsx}");
    expect(glob.match("index.ts")).toBeTrue();
    expect(glob.match("index.tsx")).toBeTrue();
    expect(glob.match("index.js")).toBeTrue();
    expect(glob.match("index.jsx")).toBeTrue();
    expect(glob.match("index.jsxxxxxxxx")).toBeFalse();
  });

  test("invalid input", () => {
    const glob = new Glob("nice");

    expect(
      returnError(() =>
        glob.match(
          // @ts-expect-error
          null,
        ),
      ),
    ).toBeDefined();
    expect(
      returnError(() =>
        glob.match(
          // @ts-expect-error
          true,
        ),
      ),
    ).toBeDefined();

    expect(
      returnError(() =>
        glob.match(
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
