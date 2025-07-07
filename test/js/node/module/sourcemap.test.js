const { test, expect } = require("bun:test");
const { SourceMap } = require("node:module");

test("SourceMap class exists", () => {
  expect(SourceMap).toBeDefined();
  expect(typeof SourceMap).toBe("function");
  expect(SourceMap.name).toBe("SourceMap");
});

test("SourceMap constructor requires payload", () => {
  expect(() => {
    new SourceMap();
  }).toThrow("SourceMap constructor requires a payload argument");
});

test("SourceMap payload must be an object", () => {
  expect(() => {
    new SourceMap("not an object");
  }).toThrow("payload must be an object");
});

test("SourceMap lineLengths must be an array if provided", () => {
  expect(() => {
    new SourceMap({}, { lineLengths: "not an array" });
  }).toThrow("lineLengths must be an array");
});

test("SourceMap instance has expected methods", () => {
  const sourceMap = new SourceMap({ 
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA"
  });
  
  expect(typeof sourceMap.findOrigin).toBe("function");
  expect(typeof sourceMap.findEntry).toBe("function");
  expect(sourceMap.findOrigin.length).toBe(2);
  expect(sourceMap.findEntry.length).toBe(2);
});

test("SourceMap payload getter", () => {
  const payload = { 
    version: 3, 
    sources: ["test.js"], 
    mappings: "AAAA" 
  };
  const sourceMap = new SourceMap(payload);
  
  expect(sourceMap.payload).toBe(payload);
});

test("SourceMap lineLengths getter", () => {
  const payload = { 
    version: 3, 
    sources: ["test.js"], 
    mappings: "AAAA" 
  };
  const lineLengths = [10, 20, 30];
  const sourceMap = new SourceMap(payload, { lineLengths });
  
  expect(sourceMap.lineLengths).toBe(lineLengths);
});

test("SourceMap lineLengths undefined when not provided", () => {
  const sourceMap = new SourceMap({ 
    version: 3, 
    sources: ["test.js"], 
    mappings: "AAAA" 
  });
  
  expect(sourceMap.lineLengths).toBeUndefined();
});

test("SourceMap findOrigin requires numeric arguments", () => {
  const sourceMap = new SourceMap({ 
    version: 3, 
    sources: ["test.js"], 
    mappings: "AAAA" 
  });
  
  expect(() => {
    sourceMap.findOrigin();
  }).toThrow("findOrigin requires lineNumber and columnNumber arguments");
  
  expect(() => {
    sourceMap.findOrigin(1);
  }).toThrow("findOrigin requires lineNumber and columnNumber arguments");
  
  expect(() => {
    sourceMap.findOrigin("not a number", 1);
  }).toThrow("lineNumber must be a number");
  
  expect(() => {
    sourceMap.findOrigin(1, "not a number");
  }).toThrow("columnNumber must be a number");
});

test("SourceMap findEntry returns mapping data", () => {
  const sourceMap = new SourceMap({ 
    version: 3, 
    sources: ["test.js"], 
    mappings: "AAAA" 
  });
  const result = sourceMap.findEntry(0, 0);
  
  expect(typeof result).toBe("object");
  // Should now return actual mapping data instead of empty object
  expect(result).toHaveProperty("generatedLine");
  expect(result).toHaveProperty("generatedColumn");
  expect(result).toHaveProperty("originalLine");
  expect(result).toHaveProperty("originalColumn");
  expect(result).toHaveProperty("source");
});

test("SourceMap findOrigin returns origin data", () => {
  const sourceMap = new SourceMap({ 
    version: 3, 
    sources: ["test.js"], 
    mappings: "AAAA" 
  });
  const result = sourceMap.findOrigin(0, 0);
  
  expect(typeof result).toBe("object");
  // Should now return actual origin data instead of empty object
  expect(result).toHaveProperty("line");
  expect(result).toHaveProperty("column");
  expect(result).toHaveProperty("source");
  expect(result).toHaveProperty("name");
});