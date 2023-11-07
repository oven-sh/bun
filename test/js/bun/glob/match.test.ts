import { expect, test, describe } from "bun:test";
import { Glob } from "bun";

describe("Glob.match", () => {
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

    glob = new Glob("src/**/hehe.ts");
    expect(glob.match("src/foo/baz/lol/hehe.ts")).toBeTrue();
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
    expect(glob.match("src/foo/bar/nice.ts")).toBeTrue();
    expect(glob.match("src/nice.ts")).toBeTrue();

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

  // Most of the potential bugs when dealing with non-ASCII patterns is when the
  // pattern matching algorithm wants to deal with single chars, for example
  // using the `[...]` syntax, it tries to match each char in the brackets. With
  // multi-byte string encodings this will break.
  test("non ascii", () => {
    let glob: Glob;

    glob = new Glob("😎/¢£.{ts,tsx,js,jsx}");
    expect(glob.match("😎/¢£.ts")).toBeTrue();
    expect(glob.match("😎/¢£.tsx")).toBeTrue();
    expect(glob.match("😎/¢£.js")).toBeTrue();
    expect(glob.match("😎/¢£.jsx")).toBeTrue();
    expect(glob.match("😎/¢£.jsxxxxxxxx")).toBeFalse();

    glob = new Glob("*é*");
    expect(glob.match("café noir")).toBeTrue();
    expect(glob.match("café noir")).toBeTrue();

    glob = new Glob("caf*noir");
    expect(glob.match("café noir")).toBeTrue();
    expect(glob.match("café noir")).toBeTrue();
    expect(glob.match("cafeenoir")).toBeTrue();

    glob = new Glob("F[ë£a]");
    expect(glob.match("Fë")).toBeTrue();
    expect(glob.match("F£")).toBeTrue();
    expect(glob.match("Fa")).toBeTrue();

    // invalid surrogate pairs
    glob = new Glob("\uD83D\u0027");
    expect(glob.match("lmao")).toBeFalse();

    glob = new Glob("\uD800\uD800");
    expect(glob.match("lmao")).toBeFalse();

    glob = new Glob("*");
    expect(glob.match("\uD800\uD800")).toBeTrue();

    glob = new Glob("hello/*/friends");
    expect(glob.match("hello/\uD800\uD800/friends")).toBeTrue();

    glob = new Glob("*.{js,\uD83D\u0027}");
    expect(glob.match("runtime.node.pre.out.ts")).toBeFalse();
    expect(glob.match("runtime.node.pre.out.js")).toBeTrue();
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
