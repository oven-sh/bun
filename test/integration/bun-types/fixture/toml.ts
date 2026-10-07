import { TOML } from "bun";
import data from "./bunfig.toml";
import { expectType } from "./utilities";

expectType<any>(data);
expectType(Bun.TOML.parse(data)).is<object>();
expectType(TOML.parse(data)).is<object>();
// `undefined` when the input is `undefined`, a function, or a symbol.
expectType(Bun.TOML.stringify({ abc: "def" })).is<string | undefined>();
expectType(TOML.stringify({ abc: "def" })).is<string | undefined>();
