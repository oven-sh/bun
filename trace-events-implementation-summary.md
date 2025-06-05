# Node.js Trace Events Implementation for Bun

## Overview

This document summarizes the implementation of Node.js trace events support in Bun, which was added to fix the failing test `test-trace-events-environment.js`.

## Problem Statement

The Node.js test suite includes `test-trace-events-environment.js` which tests the trace events functionality. This test was failing because:

- Bun didn't support the `--trace-event-categories` command line flag
- The `trace_events` module was just a stub
- No trace log files were being generated

The test expected:

- A `node_trace.1.log` file to be created
- The file to contain specific trace events like "Environment", "RunTimers", "CheckImmediate", etc.
- Events to be in Chrome Trace Event Format

## Solution Components

### 1. Command Line Support

**File**: `src/cli.zig`

Added support for the `--trace-event-categories` flag:

- Added `trace_event_categories: []const u8 = ""` field to RuntimeOptions struct
- Added parsing logic to capture the categories string from command line arguments
- The flag accepts a comma-separated list of categories

### 2. JavaScript Module Implementation

**File**: `src/js/node/trace_events.ts`

Replaced the stub implementation with a full-featured module that includes:

#### Classes:

- **`Tracing`**: Main class that manages trace event collection

  - `enable()`: Starts collecting trace events
  - `disable()`: Stops collecting and writes events to file
  - `enabled`: Property indicating if tracing is active
  - `categories`: Property listing enabled categories

- **`TraceEventCollector`**: Internal class that handles event collection
  - Maintains array of trace events
  - Hooks into Node.js lifecycle events
  - Formats and writes events to log file

#### Functions:

- **`createTracing(options)`**: Factory function to create Tracing instances
- **`getEnabledCategories()`**: Returns currently enabled trace categories

#### Event Hooks:

The implementation hooks into various Node.js events to generate traces:

- `process.exit` and `process.beforeExit`
- `setImmediate` callbacks
- `setTimeout` callbacks
- `process.nextTick` callbacks
- Process start/end events
- Environment setup

#### Output Format:

- Writes to `node_trace.{counter}.log` files
- Uses Chrome Trace Event Format (JSON)
- Includes metadata like process ID, thread ID, timestamps

### 3. Native Bindings

**Files**: `src/bun.js/bindings/NodeTraceEvents.cpp` and `.h`

Created C++ bindings to bridge command line arguments to JavaScript:

- **`Bun__setTraceEventCategories(const char* categories)`**:

  - Stores the categories string from command line
  - Called from Zig when `--trace-event-categories` is present

- **`getTraceEventCategoriesCallback(...)`**:

  - JavaScript callback that returns the stored categories
  - Registered as `$getTraceEventCategories` global function

- **`setupNodeTraceEvents(JSC::JSGlobalObject* globalObject)`**:
  - Registers the callback function on the global object
  - Called during JavaScript environment initialization

### 4. Integration Points

#### In `src/bun_js.zig`:

```zig
if (opts.trace_event_categories.len > 0) {
    Bun.setTraceEventCategories(opts.trace_event_categories);
}
```

#### In `src/bun.js/bindings/BunGlobalObject.cpp`:

```cpp
void GlobalObject::finishCreation(VM& vm) {
    // ... existing code ...
    Bun::setupNodeTraceEvents(this);
}
```

## Key Implementation Details

### Category Handling

- Categories are passed as comma-separated strings (e.g., "node.environment,node.async_hooks")
- The implementation checks if a category is enabled before generating events
- Default categories include "node", "node.environment", "node.async_hooks", etc.

### Event Generation

Events are generated with:

- `name`: Event name (e.g., "Environment", "RunTimers")
- `cat`: Category (e.g., "node.environment")
- `ph`: Phase ("B" for begin, "E" for end, "X" for complete)
- `pid`: Process ID
- `tid`: Thread ID (always 0 in this implementation)
- `ts`: Timestamp in microseconds
- `args`: Additional event-specific data

### File Naming

- Files are named `node_trace.{counter}.log`
- Counter increments for each new trace file in the same process
- Files are created in the current working directory

## Testing

The implementation passes the `test-trace-events-environment.js` test which verifies:

- The trace file is created
- It contains expected events
- Events have proper format and timing
- Categories filter events correctly

## Future Considerations

1. **Performance**: The current implementation uses JavaScript for all event collection, which may have performance implications
2. **Native Events**: Some events could be generated from native code for better accuracy
3. **Additional Categories**: More trace categories could be added for deeper insights
4. **Streaming**: Large trace files could benefit from streaming writes
5. **V8 Compatibility**: Some V8-specific trace events are not yet implemented

## Conclusion

This implementation provides Node.js-compatible trace events support in Bun, allowing developers to debug and profile their applications using familiar tools and formats. The implementation is sufficient to pass Node.js compatibility tests while leaving room for future enhancements.
