// api.ts exports objects whose getters, methods, arrays and Maps hold or return functions of the file. The importer never names those functions.
import { api, table, list, lazy, nested } from "./api";

console.log(api.viaGetter(), api.viaMethod(), api.viaProperty());
console.log(table.get("entry")!(), list[0](), list.at(-1)!());
console.log(lazy().late(), nested.a.b.c());
