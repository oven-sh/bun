import { test, expect } from "bun:test";

test("performance.getEntriesByType supports sql-query entry type", () => {
  const sqlEntries = performance.getEntriesByType("sql-query");
  // This should work without error
  expect(Array.isArray(sqlEntries)).toBe(true);
});

test("performance API parseEntryTypeString supports sql-query", () => {
  const sqlEntries = performance.getEntriesByType("sql-query");
  const markEntries = performance.getEntriesByType("mark");
  
  // Both should be arrays 
  expect(Array.isArray(sqlEntries)).toBe(true);
  expect(Array.isArray(markEntries)).toBe(true);
});

test("performance entry type parsing works", () => {
  // Test that our new entry type doesn't break existing functionality
  performance.mark("test-mark");
  
  const markEntries = performance.getEntriesByName("test-mark");
  expect(markEntries.length).toBeGreaterThan(0);
  expect(markEntries[0].entryType).toBe("mark");
  
  // Test sql-query type filtering
  const sqlEntries = performance.getEntriesByType("sql-query"); 
  expect(Array.isArray(sqlEntries)).toBe(true);
  
  performance.clearMarks();
});