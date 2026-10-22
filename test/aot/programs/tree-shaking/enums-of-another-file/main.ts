// Enums and const enums are exported and used across files: a member read by name, a member of a namespace import, the enum as a value, an enum only as a type, an enum nobody imports, and one whose members come from an enum of a third file.
import { Color, Size, type Shape, Level, Inlined } from "./enums";
import * as enums from "./enums";

function describe(shape: Shape) { return "shape " + shape; }
console.log(Color.Green, enums.Direction.Up, Object.values(Size).join(), describe(1), Level.High, Inlined.Two);
