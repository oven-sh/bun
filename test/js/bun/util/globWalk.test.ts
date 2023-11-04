import { expect, test, describe } from "bun:test";
import fg from "fast-glob";
import { Glob, GlobMatchOptions } from "bun";

const bunGlobOpts = {
  followSymlinks: true,
} satisfies GlobMatchOptions;

const fgOpts = {
  followSymbolicLinks: true,
  onlyFiles: false,
  // absolute: true,
};

describe("globwalk", async () => {
  test("recursively search node_modules", async () => {
    const pattern = "**/node_modules/**/*.js";
    const glob = new Glob(pattern);
    const filepaths = await glob.match(bunGlobOpts);
    const fgFilepths = await fg.glob(pattern, fgOpts);

    expect(filepaths.length).toEqual(fgFilepths.length);
    // console.log("FILEPATHS", filepaths.length, fgFilepths.length);
    // console.error("FG FILEPATHS", fgFilepths);

    const bunfilepaths = new Set(filepaths);
    for (const filepath of fgFilepths) {
      expect(bunfilepaths.has(filepath)).toBeTrue();
      // if (!bunfilepaths.has(filepath)) console.error("missing:", filepath);
    }
  });

  test("recursive search js files", async () => {
    const pattern = "**/*.js";
    const glob = new Glob(pattern);
    const filepaths = await glob.match(bunGlobOpts);
    const fgFilepths = await fg.glob(pattern, fgOpts);

    // console.log("FILEPATHS", filepaths.length, fgFilepths.length);
    // expect(filepaths.length).toEqual(fgFilepths.length);
    console.log("FILEPATHS", filepaths.length, fgFilepths.length);
    console.error("BUN FILEPATHS", filepaths);
    // console.error("FG FILEPATHS", fgFilepths);

    const bunfilepaths = new Set(filepaths);
    for (const filepath of fgFilepths) {
      if (!bunfilepaths.has(filepath)) console.error("Missing:", filepath);
      // expect(bunfilepaths.has(filepath)).toBeTrue();
    }
  });

  test("recursive search ts files", async () => {
    const pattern = "**/*.ts";
    const glob = new Glob(pattern);
    const filepaths = await glob.match(bunGlobOpts);
    const fgFilepths = await fg.glob(pattern, fgOpts);

    expect(filepaths.length).toEqual(fgFilepths.length);

    const bunfilepaths = new Set(filepaths);
    for (const filepath of fgFilepths) {
      expect(bunfilepaths.has(filepath)).toBeTrue();
    }
  });

  test("glob not freed before matching done", async () => {
    const promise = (async () => {
      const glob = new Glob("**/node_modules/**/*.js");
      const result = glob.match(bunGlobOpts);
      Bun.gc(true);
      const result2 = await result;
      return result2;
    })();
    Bun.gc(true);
    const values = await promise;
    Bun.gc(true);
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
