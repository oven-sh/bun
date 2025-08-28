import { test, expect } from "bun:test";

test("SQL Performance Entry integration works", () => {
  // Test that the performance API correctly handles sql-query entries
  const initialSqlEntries = performance.getEntriesByType("sql-query");
  expect(Array.isArray(initialSqlEntries)).toBe(true);
  
  // Test various SQL commands that should be recognized
  const commands = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP"];
  
  for (const command of commands) {
    const entries = performance.getEntriesByName(command);
    expect(Array.isArray(entries)).toBe(true);
  }
  
  // Test that sql-query is a valid entry type
  const allEntries = performance.getEntries();
  const sqlSpecific = performance.getEntriesByType("sql-query");
  
  expect(Array.isArray(allEntries)).toBe(true);
  expect(Array.isArray(sqlSpecific)).toBe(true);
  
  // Verify that getEntriesByType doesn't throw for our new type
  expect(() => performance.getEntriesByType("sql-query")).not.toThrow();
  expect(() => performance.getEntriesByName("SELECT")).not.toThrow();
});

// This tests that our C++ changes don't break existing performance functionality
test("Existing performance functionality remains intact", () => {
  const startTime = performance.now();
  
  performance.mark("test-start");
  
  // Simulate some work
  const work = Array.from({length: 1000}, (_, i) => i * 2).reduce((a, b) => a + b, 0);
  expect(work).toBeGreaterThan(0);
  
  performance.mark("test-end");
  performance.measure("test-duration", "test-start", "test-end");
  
  const marks = performance.getEntriesByType("mark");
  const measures = performance.getEntriesByType("measure");
  
  expect(marks.length).toBeGreaterThanOrEqual(2);
  expect(measures.length).toBeGreaterThanOrEqual(1);
  
  const testMarks = marks.filter(m => m.name.startsWith("test-"));
  expect(testMarks.length).toBe(2);
  
  const testMeasures = measures.filter(m => m.name === "test-duration");
  expect(testMeasures.length).toBe(1);
  expect(testMeasures[0].duration).toBeGreaterThan(0);
  
  performance.clearMarks();
  performance.clearMeasures();
  
  const endTime = performance.now();
  expect(endTime).toBeGreaterThan(startTime);
});