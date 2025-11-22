// Generate an object with multiple properties to test macro-generated objects
// This tests that property visiting doesn't crash when processing macro-generated objects
export function generateObject() {
  const obj: Record<string, any> = {};

  for (let i = 0; i < 50; i++) {
    obj[`key${i}`] = {
      value: i,
      nested: {
        data: `value_${i}`,
        index: i,
      },
    };
  }

  return obj;
}
