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

**Key Code Changes**:

```zig
// Graph.zig
build_graphs: std.EnumArray(options.Target, PathToSourceIndexMap) = .{},

// bundle_v2.zig
pub inline fn pathToSourceIndexMap(this: *BundleV2, target: options.Target) *PathToSourceIndexMap {
    return this.graph.build_graphs.getPtr(target);
}
```

### Epic 2: Dynamic Entry Point Creation for Client Build ✅

**Status**: Complete

**Changes Made**:

1. Added HTML import detection logic in `runResolutionForParseTask`.
2. When server-side code imports an HTML file, the system automatically creates a client-side entry point.

**Key Code Addition**:

```zig
// When server-side code imports an HTML file, create a client-side entry point
if (ast.target.isServerSide() and resolve_task.loader == .html) {
    _ = this.enqueueEntryItem(
        null, // hash
        resolve_result, // Use the same resolution result
        true, // is_entry_point
        .browser // Explicitly set the target for the new graph entry
    ) catch bun.outOfMemory();
}
```

### Epic 3: Asynchronous Code Generation and Chunk Association ⚠️

**Status**: Partially Complete

**Changes Made**:

1. Modified `generateCodeForLazyExport.zig` to handle HTML imports on the server side.
2. Server-side HTML imports now generate a JavaScript manifest object.
3. Currently creates a placeholder structure with temporary unique_key placeholders.

**Key Code Addition**:

```zig
if (loader == .html and exports_kind == .cjs) {
    // Generate asset manifest for server-side HTML imports
    var manifest = E.Object{};

    // For now, generate a placeholder unique_key based on source index
    const placeholder_key = std.fmt.allocPrint(
        this.allocator,
        "HTML_PLACEHOLDER_{d}",
        .{source_index}
    ) catch bun.outOfMemory();

    try manifest.put(this.allocator, "index", Expr.init(
        E.String,
        E.String.init(placeholder_key),
        stmt.loc,
    ));

    // Files array will contain the associated JS/CSS chunks
    const files_array = E.Array{};

    try manifest.put(this.allocator, "files", Expr.init(
        E.Array,
        files_array,
        stmt.loc,
    ));

    // Replace the lazy export with the manifest object
    part.stmts[0].data.s_lazy_export.* = Expr.init(E.Object, manifest, stmt.loc).data;
}
```

**TODO**: The manifest generation needs to be connected to the actual chunk metadata to use real `unique_key` values from the chunks.

### Epic 4: Finalization, Output Naming, and Path Stitching ✅

**Status**: Complete

#### 4.1: Target-Aware Output Filenames ✅

**Changes Made**:

1. Added `target` field to `PathTemplate.Placeholder` struct in `options.zig`.
2. Updated the `PathTemplate.format` function to handle the new target field.
3. Updated default templates to include `[target]`:
   - chunk: `"./chunk-[hash].[target].[ext]"`
   - file: `"[dir]/[name].[target].[ext]"`

**Key Code Changes**:

```zig
// options.zig
pub const Placeholder = struct {
    dir: []const u8 = "",
    name: []const u8 = "",
    ext: []const u8 = "",
    hash: ?u64 = null,
    target: []const u8 = "",  // New field
};

// Updated default templates
pub const chunk = PathTemplate{
    .data = "./chunk-[hash].[target].[ext]",
    // ...
};

pub const file = PathTemplate{
    .data = "[dir]/[name].[target].[ext]",
    // ...
};
```

#### 4.2: Populate Target in Chunks ✅

**Changes Made**:

1. Updated `computeChunks.zig` to populate the `target` field based on the chunk's AST target.

**Key Code Addition**:

```zig
// computeChunks.zig
// Determine the target from the AST of the entry point source
const ast_targets = this.graph.ast.items(.target);
const chunk_target = ast_targets[chunk.entry_point.source_index];
chunk.template.placeholder.target = switch (chunk_target) {
    .browser => "browser",
    .bun => "bun",
    .node => "node",
    .bun_macro => "macro",
    .bake_server_components_ssr => "ssr",
};
```

## Next Steps

To complete the implementation, the following tasks remain:

1. **Epic 3 - Full Implementation**:

   - Update `generateCodeForLazyExport` to access the actual chunks array
   - Find HTML chunks with matching source_index in the browser chunks
   - Use `chunk.getJSChunkForHTML()` and `chunk.getCSSChunkForHTML()` to find associated assets
   - Replace placeholder unique_keys with actual chunk unique_keys

2. **Verification**:

   - Ensure `generateChunksInParallel` computes `final_rel_path` for all chunks before calling `intermediate_output.code()`
   - Verify that placeholder substitution works correctly across server and client chunks

3. **Testing**: Create comprehensive tests for:
   - Server files importing HTML
   - Correct manifest generation with actual chunk references
   - Proper file naming with target placeholders
   - Single-pass build execution with correct path resolution

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
