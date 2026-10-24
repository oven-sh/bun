// The merged names of merged.ts are exported and used from here: the class side of one, the namespace side of another, both pieces of an enum, a function with its namespace, a default export that is a merged class.
import Default, { Shape, parse, Pieces, Level, Config } from "./merged";
import * as merged from "./merged";

const config: Config = Config;
console.log(new Shape().area(), Shape.unit, parse("x"), parse.version, Pieces.One + Pieces.Two, Level.describe(Level.High), config.port);
console.log(new Default().name(), Default.label, merged.Shape.unit, Object.keys(merged.Pieces).length);
