import { expect, test, describe } from "bun:test";
import { Glob } from "bun";

describe("globMatch", () => {
  test("single wildcard", () => {
    let glob: Glob;

    glob = new Glob("*");
    expect(glob.matchString("foo")).toBeTrue();
    expect(glob.matchString("lmao.ts")).toBeTrue();
    expect(glob.matchString("")).toBeTrue();
    expect(glob.matchString("   ")).toBeTrue();
    expect(glob.matchString("*")).toBeTrue();

    glob = new Glob("*.ts");
    expect(glob.matchString("foo.ts")).toBeTrue();
    expect(glob.matchString(".ts")).toBeTrue();
    expect(glob.matchString("")).toBeFalse();
    expect(glob.matchString("bar.tsx")).toBeFalse();
    expect(glob.matchString("foo/bar.ts")).toBeFalse();
    expect(glob.matchString("foo/bar/baz.ts")).toBeFalse();

    glob = new Glob("src/*/*.ts");
    expect(glob.matchString("src/foo/bar.ts")).toBeTrue();
    expect(glob.matchString("src/bar.ts")).toBeFalse();

    glob = new Glob("src/**/hehe.ts");
    expect(glob.matchString("src/foo/baz/lol/hehe.ts")).toBeTrue();
  });

  test("double wildcard", () => {
    let glob: Glob;

    glob = new Glob("**");
    expect(glob.matchString("")).toBeTrue();
    expect(glob.matchString("nice/wow/great/foo.ts")).toBeTrue();

    glob = new Glob("foo/**/bar");
    expect(glob.matchString("")).toBeFalse();
    expect(glob.matchString("foo/lmao/lol/bar")).toBeTrue();
    expect(glob.matchString("foo/lmao/lol/haha/wtf/nice/bar")).toBeTrue();
    expect(glob.matchString("foo/bar")).toBeTrue();

    glob = new Glob("src/**/*.ts");
    expect(glob.matchString("src/foo/bar/baz/nice.ts")).toBeTrue();
    expect(glob.matchString("src/foo/bar/nice.ts")).toBeTrue();
    expect(glob.matchString("src/nice.ts")).toBeTrue();

    glob = new Glob("src/foo/*/bar/**/*.ts");
    expect(glob.matchString("src/foo/nice/bar/baz/lmao.ts")).toBeTrue();
    expect(glob.matchString("src/foo/nice/bar/baz/lmao.ts")).toBeTrue();
  });

  test("braces", () => {
    let glob: Glob;

    glob = new Glob("index.{ts,tsx,js,jsx}");
    expect(glob.matchString("index.ts")).toBeTrue();
    expect(glob.matchString("index.tsx")).toBeTrue();
    expect(glob.matchString("index.js")).toBeTrue();
    expect(glob.matchString("index.jsx")).toBeTrue();
    expect(glob.matchString("index.jsxxxxxxxx")).toBeFalse();
  });

  // Most of the potential bugs when dealing with non-ASCII patterns is when the
  // pattern matching algorithm wants to deal with single chars, for example
  // using the `[...]` syntax, it tries to match each char in the brackets. With
  // multi-byte string encodings this will break.
  test("non ascii", () => {
    let glob: Glob;

    glob = new Glob("😎/¢£.{ts,tsx,js,jsx}");
    expect(glob.matchString("😎/¢£.ts")).toBeTrue();
    expect(glob.matchString("😎/¢£.tsx")).toBeTrue();
    expect(glob.matchString("😎/¢£.js")).toBeTrue();
    expect(glob.matchString("😎/¢£.jsx")).toBeTrue();
    expect(glob.matchString("😎/¢£.jsxxxxxxxx")).toBeFalse();

    glob = new Glob("*é*");
    expect(glob.matchString("café noir")).toBeTrue();
    expect(glob.matchString("café noir")).toBeTrue();

    glob = new Glob("caf*noir");
    expect(glob.matchString("café noir")).toBeTrue();
    expect(glob.matchString("café noir")).toBeTrue();
    expect(glob.matchString("cafeenoir")).toBeTrue();

    glob = new Glob("F[ë£a]");
    expect(glob.matchString("Fë")).toBeTrue();
    expect(glob.matchString("F£")).toBeTrue();
    expect(glob.matchString("Fa")).toBeTrue();

    // invalid surrogate pairs
    glob = new Glob("\uD83D\u0027");
    expect(glob.matchString("lmao")).toBeFalse();

    glob = new Glob("\uD800\uD800");
    expect(glob.matchString("lmao")).toBeFalse();

    glob = new Glob("*");
    expect(glob.matchString("\uD800\uD800")).toBeTrue();

    glob = new Glob("hello/*/friends");
    expect(glob.matchString("hello/\uD800\uD800/friends")).toBeTrue();

    glob = new Glob("*.{js,\uD83D\u0027}");
    expect(glob.matchString("runtime.node.pre.out.ts")).toBeFalse();
    expect(glob.matchString("runtime.node.pre.out.js")).toBeTrue();
  });

  test("invalid input", () => {
    const glob = new Glob("nice");

    expect(
      returnError(() =>
        glob.matchString(
          // @ts-expect-error
          null,
        ),
      ),
    ).toBeDefined();
    expect(
      returnError(() =>
        glob.matchString(
          // @ts-expect-error
          true,
        ),
      ),
    ).toBeDefined();

    expect(
      returnError(() =>
        glob.matchString(
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
