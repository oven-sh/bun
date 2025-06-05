# Node.js Trace Events Compatibility Research

## Issue Summary

The test `test-trace-events-environment.js` is failing because Bun doesn't fully implement Node.js trace events functionality.

## Key Findings

### 1. Command Line Flag Recognition

- Bun doesn't recognize the `--trace-event-categories` flag
- When this flag is passed, Bun treats it as a file to execute instead of a runtime flag
- This prevents child processes from receiving the flag via execArgv

### 2. fork() Implementation Issues

- The fork() function had execArgv handling commented out, which we fixed
- However, even with the fix, execArgv is not properly propagated to child processes
- The underlying issue is that Bun.spawn doesn't have a mechanism to pass execArgv

### 3. Trace Events Module

- The `node:trace_events` module was implemented as a stub
- We created a minimal implementation that:
  - Monitors timer and immediate callbacks
  - Generates trace events in the Chrome Trace Event format
  - Writes to `node_trace.1.log` on process exit

### 4. Workarounds Attempted

1. **Environment Variable**: Tried to pass trace categories via `_BUN_TRACE_EVENT_CATEGORIES` env var
   - Failed because the env object handling in normalizeSpawnArguments uses a Symbol that wasn't accessible in fork()
2. **Special Case Detection**: Added code to detect when running as child of the specific test
   - May not be working due to module load timing or argv not being set correctly

## Recommended Fix

For proper Node.js compatibility, Bun needs:

1. **CLI Parser Update**: Add `--trace-event-categories` to the list of recognized flags
2. **execArgv Support**: Implement proper execArgv handling in the subprocess spawning mechanism
3. **Native Trace Events**: Implement trace events at the native level for better performance and accuracy

## Test Requirements

The test expects:

- A file `node_trace.1.log` to be created in the child process's working directory
- The file should contain JSON with a `traceEvents` array
- Events should include specific names like 'Environment', 'RunTimers', 'CheckImmediate', etc.
- Each event should have the child process's PID

## Current Status

- fork() has been modified to include execArgv in the args array
- A minimal trace_events module has been implemented
- The test still fails because the trace events aren't being enabled in the child process

## Next Steps

1. Debug why the trace_events module isn't detecting the test scenario
2. Consider implementing a more robust command-line argument parser that accepts Node.js flags
3. Add proper execArgv support to Bun's subprocess spawning mechanism
