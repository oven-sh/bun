// The namespace of the first barrel is read under computed names. What it holds comes through one, two and three `export *`, and through a star of a file that itself exports a namespace.
import * as all from "./barrel-1";

const table = all as Record<string, any>;
for (const name of ["one", "two", "three"]) console.log(table["level" + name[0].toUpperCase() + name.slice(1)]());
console.log(table["in" + "ner"]["de" + "ep"]());
