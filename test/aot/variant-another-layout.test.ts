// The same code at other addresses: padding in front of, inside and behind the shared stubs, drawn from a seed. For measuring: a difference between two builds is read over several layouts.
// Sixteen seeds, each with a handful of programs of its own and with the one that takes the roads from one stub into the next, between which no padding may lie.
import { variant } from "./run-programs";

for (let seed = 1; seed <= 16; seed++)
  variant(
    `another-layout/${seed}`,
    { BUN_AOT_LAYOUT_SEED: String(seed) },
    {},
    seed,
    48,
    "calls-fast-paths/roads-that-cross-from-one-stub-into-the-next",
  );
