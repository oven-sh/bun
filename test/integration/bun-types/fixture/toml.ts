import { TOML } from "bun";
import data from "./bunfig.toml";
import { expectType } from "./utilities";

expectType<any>(data);
expectType(Bun.TOML.parse(data)).is<object>();
expectType(TOML.parse(data)).is<object>();
expectType(Bun.TOML.stringify({ abc: "def" })).is<string>();
expectType(TOML.stringify({ abc: "def" })).is<string>();
expectType(TOML.stringify(TOML.parse(data))).is<string>();
// `undefined` when the input is `undefined`, a function, or a symbol.
expectType(TOML.stringify(undefined)).is<undefined>();
expectType(TOML.stringify(() => {})).is<undefined>();
expectType(TOML.stringify(class {})).is<undefined>();
expectType(TOML.stringify(Symbol())).is<undefined>();
expectType(TOML.stringify({} as { abc: string } | undefined)).is<string | undefined>();
expectType(TOML.stringify({} as unknown)).is<string | undefined>();
expectType(TOML.stringify({} as any)).is<string | undefined>();
