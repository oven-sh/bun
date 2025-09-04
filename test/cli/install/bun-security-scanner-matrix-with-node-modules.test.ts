import { runSecurityScannerTests } from "./bun-security-scanner-matrix-runner";

// CI Time maxes out at 3 minutes per test file. This test takes a little while
// but is useful enough justifying keeping it. This test file runs all the tests
// with an existing node modules folder. See
// ./bun-security-scanner-matrix-without-node-modules.test.ts for tests that run
// without
runSecurityScannerTests(import.meta.path, true);
