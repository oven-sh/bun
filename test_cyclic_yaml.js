// Simple test for cyclic YAML parsing
console.log("Testing cyclic YAML parsing...");

try {
  // Test simple circular reference
  const yaml = `
parent: &ref
  name: parent  
  child:
    name: child
    parent: *ref
`;

  const result = Bun.YAML.parse(yaml);
  console.log("Result:", result);
  
  // Test referential equality
  if (result.parent.child.parent === result.parent) {
    console.log("✅ Cyclic reference test PASSED - referential equality maintained");
  } else {
    console.log("❌ Cyclic reference test FAILED - no referential equality");
    console.log("parent:", result.parent);
    console.log("child.parent:", result.parent.child.parent);
  }

} catch (err) {
  console.log("❌ Error:", err.message);
  console.log("Stack:", err.stack);
}