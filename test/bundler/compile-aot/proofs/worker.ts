import { plain, arrow, Derived, even, callsWithinModule } from "./lib";
import { num, chain1, pingStr, fact } from "./rets";
import { notShadowed } from "./shadow";
import * as no from "./noobject";
import { ordinary, viaCallbacks, describe, noThis, template } from "./execs";
import { wantsNumber, attempt } from "./checks";
postMessage([plain(10, 20), arrow(30), new Derived(1).get(), even(6), callsWithinModule(), num() + chain1(), pingStr(3) + 1, fact(5), notShadowed(), no.callsOthers(3), no.catches(), no.callsTrims(), no.imports(), ordinary(1), viaCallbacks(), describe(ordinary), JSON.stringify(new (noThis as any)(1)), template() === template(), attempt(v => wantsNumber(v, 1), [1, "x", null])].join(" "));
