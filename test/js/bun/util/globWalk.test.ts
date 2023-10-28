import { expect, test, describe } from "bun:test";
import { Glob } from "bun";

describe("globwalk", async () => {
  const glob = new Glob("src/**/*.ts");
  const filepaths = await glob.match();
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
