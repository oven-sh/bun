import { TOML } from "bun";
import data from "./bunfig.toml";
import { expectType } from "./utilities";

expectType<any>(data);
expectType(Bun.TOML.parse(data)).is<object>();
expectType(TOML.parse(data)).is<object>();
