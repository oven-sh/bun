import { bunEnv, isASAN, isGlibc } from "harness";

// The environment of a child process in which one big allocation fails: a reserve of the bundler's
// entry point enqueue. An ASAN build refuses each allocation over 1 MiB. In a release build mimalloc
// has no OS to ask and its arena refuses an object over 4 MiB, which is measured on Linux x64 glibc only.
export const canFailReserve = isASAN || (isGlibc && process.arch === "x64");

export const failingReserveEnv = isASAN
  ? {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=1"]
        .filter(Boolean)
        .join(":"),
    }
  : {
      ...bunEnv,
      MIMALLOC_DISALLOW_OS_ALLOC: "1",
      MIMALLOC_RESERVE_OS_MEMORY: "256MiB",
      MIMALLOC_ARENA_MAX_OBJECT_SIZE: "4MiB",
    };
