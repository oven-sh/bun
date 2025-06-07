# Unified Full-Stack Builds Implementation Summary

## Overview

This document summarizes the implementation of the unified full-stack builds feature for `bun build`, which enables building both server and client applications from a single command when a server entry point imports an HTML file.

## Architecture

The implementation follows a single-pass build strategy where:

1. Everything is built in parallel
2. `unique_key` placeholders are used during code generation
3. At the final stage, all placeholders are resolved to actual paths and manifests

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

### Epic 3: HTML Import Manifest Generation ✅

**Status**: Complete

**Changes Made**:

1. **generateCodeForLazyExport.zig**:

   - Detects HTML imports from server-side code
   - Replaces the lazy export with a placeholder: `{unique_key}H{html_idx:0>8}`
   - This placeholder is resolved to the full manifest during output generation

2. **Chunk.zig**: Added `html_import` to `OutputPiece.Query.Kind` enum

   - Expanded Kind enum from 2 bits to 3 bits to accommodate the new type
   - Added handling in `codeWithSourceMapShifts` to generate the manifest JSON

3. **LinkerContext.zig**: Added 'H' prefix handling in `breakOutputIntoPieces`

4. The manifest is generated with the complete structure including:
   - `index`: Path to the HTML file
   - `files`: Array of all associated assets with:
     - `path`: Final output path
     - `loader`: File type (html, js, css)
     - `hash`: Content hash for cache busting

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
2. This ensures HTML files get chunks assigned and can be referenced

## How It Works

When a server file imports an HTML file:

1. **Detection**: During resolution, the bundler detects `loader == .html` from server-side code
2. **Tracking**: The import is tracked in `graph.html_imports` with server and HTML source indices
3. **Client Entry**: A new browser-target entry point is created for the HTML file
4. **Lazy Export**: The server's HTML import is replaced with a `S.LazyExport` containing a placeholder
5. **Entry Point Addition**: HTML files are added as entry points to ensure chunk assignment
6. **Manifest Generation**: During output generation, the placeholder is replaced with a complete manifest:
   ```js
   {
     index: "file-name.html",
     files: [
       { path: "file-name.html", loader: "html", hash: "abc123" },
       { path: "chunk-def456.js", loader: "js", hash: "def456" },
       { path: "chunk-ghi789.css", loader: "css", hash: "ghi789" }
     ]
   }
   ```

## Implementation Pattern

The implementation follows a late-binding pattern:

- HTML imports are tracked during parsing
- Placeholders are generated during code generation
- Entry points are added before linking
- Manifests are generated during final output when all paths and hashes are known

## Example Usage

Server code:

```js
// server.js
import htmlManifest from "./index.html";

// htmlManifest will be:
// {
//   index: "./index.browser.html",
//   files: [
//     { path: "./index.browser.html", loader: "html", hash: "abc123" },
//     { path: "./chunk-def456.browser.js", loader: "js", hash: "def456" },
//     { path: "./chunk-ghi789.browser.css", loader: "css", hash: "ghi789" }
//   ]
// }
```

The HTML file is processed as a browser entry point, bundling all its dependencies into client-side chunks while the server receives a manifest with complete metadata about all generated assets.

## Technical Details

- **Tracking**: `graph.html_imports` stores server->HTML import relationships
- **Lazy Export**: Server imports become `S.LazyExport` statements with placeholders
- **Output Piece**: New `html_import` kind added to handle manifest generation
- **Placeholder Format**: `{unique_key}H{html_idx:0>8}` identifies HTML imports
- **Manifest Generation**: Happens in `Chunk.codeWithSourceMapShifts` with access to final paths and hashes
- **Target Isolation**: Each target maintains its own module graph via `build_graphs`

## Benefits

This implementation enables developers to:

- Build full-stack applications with a single command
- Automatically handle client-side entry points when importing HTML from server code
- Get detailed asset manifests with paths and hashes for server-side rendering
- Implement cache busting strategies with content hashes
- Maintain separate build graphs for different targets while sharing common resources
- Avoid filename collisions through target-specific naming

## Technical Highlights

- **Single-Pass Build**: Everything builds in parallel, maximizing performance
- **Late-Stage Path Resolution**: Using `unique_key` placeholders allows deferring path resolution until all information is available
- **Target Isolation**: Each target maintains its own module graph to prevent conflicts
- **Automatic Entry Points**: HTML imports trigger client builds automatically
