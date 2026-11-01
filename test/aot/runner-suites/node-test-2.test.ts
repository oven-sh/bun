import { holdSuitesOffSanitizers } from "../harness/runner-suites";

// Not on the lane with the sanitizer, which has no minute to spare: 0 finds in the 181 child runs of issues, others and node-test-1 | -2. AOT_EVERY_SUITE=1 runs them there too.
holdSuitesOffSanitizers("test/js/node/test_runner/node-test.test.ts 2/2");
