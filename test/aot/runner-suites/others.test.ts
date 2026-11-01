import { holdSuitesOffSanitizers } from "../harness/runner-suites";

// Not on the lane with the sanitizer, which has no minute to spare: 0 finds in the 181 child runs of issues, others and node-test-1 | -2. AOT_EVERY_SUITE=1 runs them there too.
holdSuitesOffSanitizers(
  "test/js/bun/gc/gc-controller-cadence.test.ts",
  "test/js/bun/jsc/webkit-upgrade-3722912f.test.ts",
  "test/js/bun/shell/bunshell-default.test.ts",
  "test/js/bun/sourcemap/internal-sourcemap.test.ts",
  "test/js/bun/spawn/job-object-bug.test.ts",
  "test/js/bun/webview/webview-chrome-pipe.test.ts",
  "test/js/node/disallow-code-generation-from-strings.test.ts",
  "test/js/node/http/node-http-proxy-url.test.ts",
  "test/js/node/missing-module.test.js",
  "test/js/node/quic/quic-endpoint.test.ts",
  "test/js/web/abort/abort.test.ts",
);
