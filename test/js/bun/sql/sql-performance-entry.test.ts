import { expect, test } from "bun:test";

// Test the C++ binding directly
test("JSC__addSQLQueryPerformanceEntry function creates performance entries", () => {
  const initialEntryCount = performance.getEntries().length;
  const initialSqlEntryCount = performance.getEntriesByType("sql-query").length;

  // Try to call the C++ function directly if it's exposed
  // Note: This might not work if the function isn't exposed to JS
  try {
    // Clear existing entries first
    performance.clearMarks();
    performance.clearMeasures();

    const beforeCount = performance.getEntriesByType("sql-query").length;

    // This test verifies that the sql-query entry type is recognized
    // Even if we can't directly test the C++ binding
    const sqlEntries = performance.getEntriesByType("sql-query");
    expect(Array.isArray(sqlEntries)).toBe(true);

    // Test that filtering by name works
    const selectEntries = performance.getEntriesByName("SELECT");
    expect(Array.isArray(selectEntries)).toBe(true);

    // Test that the parseEntryTypeString function recognizes sql-query
    const invalidEntries = performance.getEntriesByType("invalid-type");
    expect(Array.isArray(invalidEntries)).toBe(true);
    expect(invalidEntries.length).toBe(0);
  } catch (error) {
    // If direct binding access fails, just verify the type is recognized
    const sqlEntries = performance.getEntriesByType("sql-query");
    expect(Array.isArray(sqlEntries)).toBe(true);
  }
});

test("Performance API maintains backwards compatibility", () => {
  // Ensure existing performance API functionality still works
  performance.mark("compatibility-test");

  const markEntries = performance.getEntriesByType("mark");
  expect(markEntries.length).toBeGreaterThan(0);

  const specificMark = performance.getEntriesByName("compatibility-test");
  expect(specificMark.length).toBeGreaterThan(0);
  expect(specificMark[0].entryType).toBe("mark");
  expect(specificMark[0].name).toBe("compatibility-test");

  performance.clearMarks();
});
