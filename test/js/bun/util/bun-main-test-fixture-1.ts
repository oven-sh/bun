// this runs with bun:test, but it's not named .test.ts because it is meant to be run in CI by bun-main.test.ts, not on its own
// this override should not persist once we start running bun-main-test-fixture-2.ts
(Bun as any).main = "foo";
