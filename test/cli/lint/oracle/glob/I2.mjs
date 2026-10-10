import { generate } from "./npm.mjs";
import { J, P, require } from "./refs.mjs";
const ignore = require(P+"ignore");
export const cases = (seed, count) => generate(seed, count, "npm705", ignore.default ?? ignore);
