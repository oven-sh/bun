import { expect, test, describe } from "bun:test";
import { Glob } from "bun";

describe("globwalk", async () => {
  const glob = new Glob("*.zig");
  const filepaths = await glob.match({ cwd: "/Users/zackradisic/Code/bun/src" });
  console.log("Filepaths", filepaths);
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
