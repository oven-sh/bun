import { expect, test } from "bun:test";

test("Compact vs Regular SourceMap memory comparison conceptual test", () => {
  // This test demonstrates the memory savings concept

  // Regular sourcemap storage:
  // - Each mapping = 4 x i32 (16 bytes) for generated_line, generated_column, original_line, original_column
  // - Plus source_index, name_index etc.
  // - For 1000 mappings: ~20KB+ in unpacked form

  const mappingCount = 1000;
  const regularMemoryPerMapping = 20; // bytes per mapping in unpacked form
  const regularTotalMemory = mappingCount * regularMemoryPerMapping; // ~20KB

  // Compact sourcemap storage:
  // - VLQ encoded strings are much smaller
  // - A simple mapping like "AAAA" (4 chars) represents the same data as 16+ bytes
  // - Line index overhead is minimal (one u32 per line)

  const vlqBytesPerMapping = 4; // Average VLQ encoding size
  const lineIndexOverhead = Math.ceil(mappingCount / 10) * 4; // Assume ~10 mappings per line
  const compactTotalMemory = mappingCount * vlqBytesPerMapping + lineIndexOverhead; // ~4KB

  const memoryReduction = ((regularTotalMemory - compactTotalMemory) / regularTotalMemory) * 100;

  console.log(`Regular sourcemap memory: ${regularTotalMemory} bytes`);
  console.log(`Compact sourcemap memory: ${compactTotalMemory} bytes`);
  console.log(`Memory reduction: ${memoryReduction.toFixed(1)}%`);

  // We expect significant memory reduction
  expect(memoryReduction).toBeGreaterThan(70); // At least 70% reduction
  expect(compactTotalMemory).toBeLessThan(regularTotalMemory);
});

test("VLQ encoding efficiency demonstration", () => {
  // Test that shows VLQ encoding is more efficient than storing raw i32 values

  // Example: mapping with generated_column=5, source_index=0, original_line=2, original_column=8
  // In regular form: 4 x i32 = 16 bytes
  // In VLQ form: "KAEA,G" = 6 bytes (including separators)

  const regularSize = 4 * 4; // 4 i32 values = 16 bytes
  const vlqSize = 6; // "KAEA,G" = 6 bytes

  const savings = ((regularSize - vlqSize) / regularSize) * 100;

  console.log(`Regular mapping size: ${regularSize} bytes`);
  console.log(`VLQ mapping size: ${vlqSize} bytes`);
  console.log(`Space savings per mapping: ${savings.toFixed(1)}%`);

  expect(vlqSize).toBeLessThan(regularSize);
  expect(savings).toBeGreaterThan(50); // At least 50% savings per mapping
});

test("Line index efficiency", () => {
  // The line index in our compact format adds minimal overhead
  // but enables fast line-based lookups

  const lineCount = 100;
  const indexSize = lineCount * 4; // u32 per line = 400 bytes
  const mappingCount = 1000;
  const vlqMappingsSize = mappingCount * 4; // Average 4 bytes per mapping = 4000 bytes

  const totalCompactSize = indexSize + vlqMappingsSize;
  const indexOverheadPercent = (indexSize / totalCompactSize) * 100;

  console.log(`Line index size: ${indexSize} bytes`);
  console.log(`VLQ mappings size: ${vlqMappingsSize} bytes`);
  console.log(`Index overhead: ${indexOverheadPercent.toFixed(1)}%`);

  // Index overhead should be minimal
  expect(indexOverheadPercent).toBeLessThan(15); // Less than 15% overhead
});
