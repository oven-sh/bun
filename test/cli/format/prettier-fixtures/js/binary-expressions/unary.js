const anyTestFailures = !(
  aggregatedResults.numFailedTests === 0 &&
  aggregatedResults.numRuntimeErrorTestSuites === 0
);
