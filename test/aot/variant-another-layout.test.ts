// The same code at other addresses: the seed shuffles the shared stubs and shifts the compiled functions by a few words. For measuring: a difference between two builds is read over several layouts.
// Sixteen seeds, each with a handful of programs of its own and with the one program whose paths cross from one stub into another, which is what a different order can break.
import { variant } from "./run-programs";

for (let seed = 1; seed <= 16; seed++)
  variant(
    `another-layout/${seed}`,
    [`--aot-layout-seed=${seed}`],
    {},
    seed,
    48,
    "calls-fast-paths/roads-that-cross-from-one-stub-into-the-next",
  );
