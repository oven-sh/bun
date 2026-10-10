import { generate } from "./npm.mjs";
import { J, P, require } from "./refs.mjs";
const ignore = require(J+"@typescript-eslint/eslint-plugin/node_modules/ignore");
export const cases = (seed, count) => generate(seed, count, "npm7012", ignore.default ?? ignore);
