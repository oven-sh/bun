// M1n: the generator of M1, without `dot`.
import { generate } from "./M1.mjs";
export const cases = (seed, count) => generate(seed, count, "minimatch-nodot", {});
