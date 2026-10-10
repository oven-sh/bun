import { generate } from "./npm.mjs";
import { J, P, require } from "./refs.mjs";
const ignore = require(J+"ignore");
export const cases = (seed, count) => generate(seed, count, "npm5", ignore.default ?? ignore);
