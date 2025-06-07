# Unified Full-Stack Builds Implementation Summary

## Overview

This document summarizes the implementation of the unified full-stack builds feature for `bun build`, which enables building both server and client applications from a single command when a server entry point imports an HTML file.

## Architecture

The implementation follows a single-pass build strategy where:

1. Everything is built in parallel
2. `unique_key` placeholders are used during code generation
3. At the final stage, all placeholders are resolved to actual paths

## Implemented Epics

### Epic 1: Multi-Target Graph Architecture ✅

**Status**: Complete

**Changes Made**:

1. **Graph.zig**: Replaced three separate `path_to_source_index_map` fields with a single `std.EnumArray(options.Target, PathToSourceIndexMap)` structure named `build_graphs`.
2. **bundle_v2.zig**: Updated the `pathToSourceIndexMap` function to use the new `build_graphs` structure.
3. **DevServer.zig**: Updated all direct references to use the new target-aware structure.
4. Updated all code throughout the codebase to use the target-aware `pathToSourceIndexMap` function.

**Key Code Changes**:

```zig
// Graph.zig
build_graphs: std.EnumArray(options.Target, PathToSourceIndexMap) = .{},

// bundle_v2.zig
pub inline fn pathToSourceIndexMap(this: *BundleV2, target: options.Target) *PathToSourceIndexMap {
    return this.graph.build_graphs.getPtr(target);
}
```

### Epic 2: Entry Point & Graph Population Logic ✅

**Status**: Complete

**Changes Made**:

1. **bundle_v2.zig**: Added HTML import detection in `runResolutionForParseTask`
2. When server code imports HTML:
   - Creates a client-side entry point with `target: .browser`
   - Calls `this.enqueueParseTask` with the HTML file and browser target
   - Tracks the import in `graph.html_imports` for manifest generation
3. **Graph.zig**: Added `html_imports` structure to track server->HTML imports

### Epic 3: Server-Side Code Generation for HTML Imports ✅

**Status**: Complete

**Changes Made**:

1. **generateCodeForLazyExport.zig**: When server code imports HTML (loader == .html and exports_kind == .cjs):
   - Checks if the source is in the `html_imports` tracking
   - When found, generates a manifest object with unique_key placeholders:
     - HTML file path uses `{unique_key}A{html_idx:0>8}` format (asset placeholder)
     - Client chunk path uses `{unique_key}S{html_idx:0>8}` format (resolved via entry_point_chunk_index)
   - The manifest is exported as `module.exports` for CommonJS compatibility

### Epic 4: Target-Aware Output Filenames ✅

**Status**: Complete

**Changes Made**:

1. **options.zig**:
   - Added `target: []const u8 = ""` field to `PathTemplate.Placeholder`
   - Updated placeholder map to include the target field
   - Updated `PathTemplate.format` to handle the new target field
2. **computeChunks.zig**: Populates the target field based on chunk's AST target
3. Updated default templates to include `[target]`:
   - chunk: `"./chunk-[hash].[target].[ext]"`
   - file: `"[dir]/[name].[target].[ext]"`

### Epic 5: HTML Imports as Entry Points ✅

**Status**: Complete

**Changes Made**:

1. **bundle_v2.zig**: Added `addHTMLImportsAsEntryPoints()` function
   - Similar to `addServerComponentBoundariesAsExtraEntryPoints()`
   - Adds HTML files from `html_imports` tracking as entry points
   - Called after `processFilesToCopy` and before `cloneAST`
2. This ensures HTML files get chunks assigned and can be referenced via the 'S' prefix

## How It Works

When a server file imports an HTML file:

1. **Detection**: During resolution, the bundler detects `loader == .html` from server-side code
2. **Tracking**: The import is tracked in `graph.html_imports` with server and HTML source indices
3. **Client Entry**: A new browser-target entry point is created for the HTML file
4. **Entry Point Addition**: HTML files are added as entry points to ensure chunk assignment
5. **Manifest Generation**: During lazy export generation, the server import is replaced with:
   - `html`: Path to the HTML asset file (using 'A' prefix)
   - `entryChunk`: Path to the client-side JavaScript chunk (using 'S' prefix)
6. **Placeholder Resolution**: During final output generation, placeholders are resolved to actual paths

## Implementation Pattern

The implementation follows the same pattern as Server Components:

- HTML imports are tracked during parsing
- Entry points are added before linking
- Manifest generation happens during code generation
- Unique key placeholders are resolved at the final stage

## Example Usage

Server code:

```js
// server.js
import htmlManifest from "./index.html";

// htmlManifest will be:
// {
//   html: "./index.browser.html",
//   entryChunk: "./chunk-abc123.browser.js"
// }
```

The HTML file is processed as a browser entry point, bundling all its dependencies into a client-side chunk while the server receives metadata about the generated assets.

## Next Steps

The core implementation is complete. The following enhancements could be added:

1. **CSS Chunk References**: When HTML files have associated CSS chunks, include them in the manifest.
2. **Source Maps**: Ensure source maps work correctly for the generated client bundles.
3. **Hot Module Replacement**: Support HMR for HTML imports in development mode.
4. **Asset Optimization**: Apply optimizations to HTML files (minification, etc.).
5. **Testing**: Add comprehensive test coverage for all edge cases.

## Implementation Notes

- The implementation uses Bun's existing `unique_key` placeholder system for late-stage path resolution
- HTML files are treated as both assets (for copying) and entry points (for bundling)
- The manifest format is designed to be extensible for future enhancements
- The single-pass architecture with `unique_key` placeholders ensures efficient bundling

## Benefits

This implementation enables developers to:

- Build full-stack applications with a single command
- Automatically handle client-side entry points when importing HTML from server code
- Get proper asset manifests for server-side rendering
- Maintain separate build graphs for different targets while sharing common resources
- Avoid filename collisions through target-specific naming

## Technical Highlights

- **Single-Pass Build**: Everything builds in parallel, maximizing performance
- **Late-Stage Path Resolution**: Using `unique_key` placeholders allows deferring path resolution until all information is available
- **Target Isolation**: Each target maintains its own module graph to prevent conflicts
- **Automatic Entry Points**: HTML imports trigger client builds automatically
