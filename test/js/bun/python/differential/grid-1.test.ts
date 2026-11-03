// Samples of the grid of calls of built-in methods, operators and functions: see README.md.
import { differential } from "./harness";

differential(name => Number(/^extra\/grid_(\d+)_/.exec(name)?.[1]) <= 53);
