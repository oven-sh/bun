// tools.ts says `export import hammer = Tools.hammer`: the alias is the only reference to the function, and main.ts imports the alias.
import { hammer, Nested } from "./tools";
import * as tools from "./tools";

console.log(hammer(), Nested.saw(), tools.Nested.drill());
