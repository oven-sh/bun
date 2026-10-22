// The first declaration of each name is a signature without a body; the body comes last. The names are imported, re-exported by a barrel, and read from a namespace.
import { format } from "./lib";
import { parse } from "./barrel";
import * as lib from "./lib";
import build from "./lib";

console.log(format(1), format("a"), parse("1"), parse(2), lib.measure([1]), lib.measure("ab"), build(1), build());
