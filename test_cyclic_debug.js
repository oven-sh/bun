// Debug test for cyclic YAML parsing
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

  console.log("YAML input:", yaml);
  const result = Bun.YAML.parse(yaml);
  
  console.log("Raw result structure:");
  console.log("- Has parent:", "parent" in result);
  console.log("- Parent has name:", "name" in result.parent);
  console.log("- Parent has child:", "child" in result.parent);
  console.log("- Child has name:", "name" in result.parent.child);
  console.log("- Child has parent:", "parent" in result.parent.child);
  console.log("- Child parent type:", typeof result.parent.child.parent);
  console.log("- Child parent value:", result.parent.child.parent);
  console.log("- Child parent === undefined:", result.parent.child.parent === undefined);
  console.log("- Child parent === null:", result.parent.child.parent === null);
  
  // Test referential equality
  if (result.parent.child.parent === result.parent) {
    console.log("✅ Cyclic reference test PASSED");
  } else if (result.parent.child.parent === undefined) {
    console.log("❌ Cyclic reference is undefined - placeholder not resolved");
  } else {
    console.log("❌ Cyclic reference test FAILED - not the same object");
    console.log("Expected:", result.parent);
    console.log("Actual:", result.parent.child.parent);
  }

} catch (err) {
  console.log("❌ Error:", err.message);
  console.log("Stack:", err.stack);
}