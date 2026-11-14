// The tests of mock-module.test.ts once more, with a twin file beside each ES module of their fixtures.
// See `twoFiles` there, also for the tests that this pass leaves out.
await import("./mock-module.test.ts?two-files" as string);
