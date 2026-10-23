// With 64-bit references, and with 1 MB of address space reserved for objects instead of 32 GB. Once that is full, blocks come
// from the general allocator, so nearly every object lies outside the reserved range, as in a program that has outgrown it.
import { variant } from "./run-programs";

variant(
  "wide-references-outside-the-reserved-range",
  ["--aot-huge-heap"],
  { BUN_JSC_markedBlockCageSizeInMB: "1" },
  3,
  3,
);
