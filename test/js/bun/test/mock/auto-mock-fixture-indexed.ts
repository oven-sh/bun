// Fixture for the integer-keyed-property path of mock-module.test.ts. A plain
// object with numeric own-keys (e.g. an HTTP status-code handler map) — the
// auto-mock walker must route those through putDirectIndex instead of
// putDirect, otherwise JSC's `ASSERT(!parseIndex)` fires on the debug / ASAN
// build when the mock is constructed.

export const handlers = {
  0: () => "zero",
  1: () => "one",
  42: () => "forty-two",
  name: "handlers",
};
