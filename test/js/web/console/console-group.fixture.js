// Basic group
console.group("Basic group");
console.log("Inside basic group");
console.groupEnd();

// Nested groups
console.group("Outer group");
console.log("Inside outer group");
console.group("Inner group");
console.log("Inside inner group");
console.groupEnd();
console.log("Back to outer group");
console.groupEnd();

// Multiple nested groups
console.group("Level 1");
console.group("Level 2");
console.group("Level 3");
console.log("Deep inside");
console.groupEnd();
console.groupEnd();
console.groupEnd();

// Empty groups
console.group();
console.groupEnd();

// Undefined groups
console.group(undefined);
console.groupEnd();

console.group("Empty nested");
console.group();
console.groupEnd();
console.groupEnd();

// Extra groupEnd calls should be ignored
console.group("Test extra end");
console.log("Inside");
console.groupEnd();
console.groupEnd(); // Extra
console.groupEnd(); // Extra

// Group with different log types
console.group("Different logs");
console.log("Regular log");
console.info("Info log");
console.warn("Warning log");
console.error("Error log");
console.debug("Debug log");
console.groupEnd();

// Groups with objects/arrays
console.group("Complex types");
console.log({ a: 1, b: 2 });
console.log([1, 2, 3]);
console.groupEnd();

// Falsy values as group labels
console.group(null);
console.group(undefined);
console.group(0);
console.group(false);
console.group("");
console.log("Inside falsy groups");
console.groupEnd();
console.groupEnd();
console.groupEnd();
console.groupEnd();
console.groupEnd();

// Unicode and special characters
console.group("🎉 Unicode!");
console.log("Inside unicode group");
console.group('Tab\tNewline\nQuote"Backslash');
console.log("Special chars");
console.groupEnd();
console.groupEnd();
