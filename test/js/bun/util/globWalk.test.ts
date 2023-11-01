import { expect, test, describe } from "bun:test";
import fg from "fast-glob";
import { Glob } from "bun";

describe("globwalk", async () => {
  // const pattern = "**/node_modules/**/*.js";
  const pattern = "**/*.js";
  // const pattern = "**/*.ts";
  const glob = new Glob(pattern);
  const filepaths = await glob.match({ cwd: "/Users/zackradisic/Code/bun" });
  const fgFilepths = await fg.glob(pattern, {
    cwd: "/Users/zackradisic/Code/bun",
    followSymbolicLinks: false,
    onlyFiles: false,
    absolute: true,
  });
  // console.log("Filepaths", filepaths);
  console.log("Bun filepaths: ", filepaths.length);
  console.log("FG filepaths: ", fgFilepths.length);

  // console.log("Bun", filepaths);
  const bunfilepaths = new Set(filepaths);
  for (const filepath of fgFilepths) {
    if (!bunfilepaths.has(filepath)) {
      console.error("missing:", filepath);
    }
  }
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
