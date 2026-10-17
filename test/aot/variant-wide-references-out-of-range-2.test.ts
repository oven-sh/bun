// With 64-bit references, and with 1 MB of address space reserved for objects in the place of 32 GB. Once that is full, blocks come
// from the general allocator, so nearly every object lies outside the reserved range, as in a program that has outgrown it.
import { variant } from "./run-programs";

variant("wide-references-outside-the-reserved-range", { BUN_JSC_useAOTWideReferences: "1" }, { BUN_JSC_markedBlockCageSizeInMB: "1" }, 2, 3);
