import { expectType } from "./utilities";
import math, { add, sum_bytes } from "./math.c";

expectType<any>(add(40, 2));
expectType<any>(sum_bytes(new Uint8Array(4), 4n));
expectType<any>(math.add);
