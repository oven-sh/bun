import { expect, test, describe } from "bun:test";
import fg from "fast-glob";
import { Glob } from "bun";

describe("globwalk", async () => {
  test("recursively search node_modules", async () => {
    const pattern = "**/node_modules/**/*.js";
    const glob = new Glob(pattern);
    const filepaths = await glob.match();
    const fgFilepths = await fg.glob(pattern, {
      followSymbolicLinks: false,
      onlyFiles: false,
      absolute: true,
    });

    expect(filepaths.length).toEqual(fgFilepths.length);
    // console.log("FILEPATHS", filepaths.length, fgFilepths.length);

    const bunfilepaths = new Set(filepaths);
    for (const filepath of fgFilepths) {
      expect(bunfilepaths.has(filepath)).toBeTrue();
      // if (!bunfilepaths.has(filepath)) console.error("missing:", filepath);
    }
  });

  test("recursive search js files", async () => {
    const pattern = "**/*.js";
    const glob = new Glob(pattern);
    const filepaths = await glob.match();
    const fgFilepths = await fg.glob(pattern, {
      followSymbolicLinks: false,
      onlyFiles: false,
      absolute: true,
    });

    // console.log("FILEPATHS", filepaths.length, fgFilepths.length);
    expect(filepaths.length).toEqual(fgFilepths.length);

    const bunfilepaths = new Set(filepaths);
    for (const filepath of fgFilepths) {
      expect(bunfilepaths.has(filepath)).toBeTrue();
    }
  });

  test("recursive search ts files", async () => {
    const pattern = "**/*.ts";
    const glob = new Glob(pattern);
    const filepaths = await glob.match();
    const fgFilepths = await fg.glob(pattern, {
      followSymbolicLinks: false,
      onlyFiles: false,
      absolute: true,
    });

    expect(filepaths.length).toEqual(fgFilepths.length);

    const bunfilepaths = new Set(filepaths);
    for (const filepath of fgFilepths) {
      expect(bunfilepaths.has(filepath)).toBeTrue();
    }
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
