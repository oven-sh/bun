// The collector, the interpreter, Python objects in JavaScript, what once crashed or hung: see README.md.
import { differential } from "./harness";

differential(name => !/^(lang\/|mod_|extra\/grid_)/.test(name));
