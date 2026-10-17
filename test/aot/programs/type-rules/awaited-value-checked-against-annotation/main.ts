// What comes of awaiting an object may be anything, because an heir may have a `then`. Where the program writes down a type for it, at a variable or a parameter, the value is held to that type.
import { Core } from "./core.ts";
import { Heir } from "./heir.js";

const core: Core = new Heir();
const attempt = async (label: string, run: () => Promise<unknown>) => {
  try {
    console.log(label + ":", String(await run()));
  } catch (error) {
    console.log(label + ":", (error as Error).constructor.name);
  }
};
const take = (given: Core) => given.n;

await attempt("nothing is written", async () => {
  const got = await core;
  return typeof got;
});
await attempt("a variable with a type", async () => {
  const got: Core = await core;
  return typeof got;
});
await attempt("a parameter with a type", async () => take(await core));
await attempt("a variable with a type, and the value fits", async () => {
  const got: Core = await (new Core() as Core);
  return got.n;
});
