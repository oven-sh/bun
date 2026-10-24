// Each constant, class and enum of values.ts is named in its own file only by the export that hands it out. It is used here once, each through another kind of export and import. Beside each stands one that nobody imports.
import byDefault, { direct, renamed, "quoted name" as quoted, Klass, Kind, fromPattern, fromArray } from "./values";
import { viaStar, viaNamedBarrel, inner } from "./barrel";
import * as values from "./values";
import viaImportEquals = require("./values");

console.log(byDefault.kind, direct, renamed, quoted, new Klass().name(), Kind.A, fromPattern, fromArray);
console.log(viaStar, viaNamedBarrel, inner.viaNamespaceExport);
console.log(values.viaNamespace, viaImportEquals.viaImportEquals, require("./values").viaRequire, (await import("./values")).viaImportCall);
