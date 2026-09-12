// Fixture for map-set-table-conservative-root.test.ts.

#include <stdint.h>

#ifdef _WIN32
#define FFI_EXPORT __declspec(dllexport)
#else
#define FFI_EXPORT __attribute__((visibility("default")))
#endif

#define MAX_WORDS 32768

// Keeps `count` addresses, `step` bytes apart from `start`, in this frame while `callback` runs.
// The words are volatile and are read back after the call, so they stay in stack memory, where a
// conservative collector that runs inside `callback` finds them. Returns how many words it read back.
FFI_EXPORT uint32_t hold_addresses(uint64_t start, uint64_t step, uint32_t count, void (*callback)(void))
{
    volatile uintptr_t words[MAX_WORDS];
    if (count > MAX_WORDS)
        count = MAX_WORDS;
    for (uint32_t i = 0; i < count; i++)
        words[i] = (uintptr_t)(start + (uint64_t)i * step);
    callback();
    uint32_t seen = 0;
    for (uint32_t i = 0; i < count; i++)
        seen += words[i] != 0;
    return seen;
}
