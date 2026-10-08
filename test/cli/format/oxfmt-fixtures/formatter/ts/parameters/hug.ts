 const assertFilteringFor = (expected: {
   [T in TestFilterTerm]?: boolean;
 }) => {};

// Should not hug
export async function update(
  options: {
    eventKey?: ConfigEvent.ConfigEventKey;
  } = {},
): Promise<void> {
}
