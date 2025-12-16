// Issue #22656 - Panic when macros return collections with 3+ arrays/objects
// https://github.com/oven-sh/bun/issues/22656

export function collectionOfArrays() {
  // Returns an array containing 3+ arrays - this triggers the crash
  return [
    { a: [] },
    { b: [] },
    { c: [] }
  ];
}

export function collectionOfObjects() {
  // Returns an array containing 3+ objects - this also triggers the crash
  return [
    { a: {} },
    { b: {} },
    { c: {} }
  ];
}

export function deeplyNested() {
  // Complex nested structure with multiple arrays and objects
  const base = {
    type: 'root',
    children: [
      { type: 'child1', data: { arrays: [[], [], []] } },
      { type: 'child2', data: { objects: [{}, {}, {}] } },
      { type: 'child3', nested: { deep: { values: [1, 2, 3] } } }
    ],
    meta: Array.from({ length: 5 }, (_, i) => ({
      id: i,
      value: { empty: {} }
    }))
  };

  // Return multiple copies using JSON parse/stringify pattern (from issue #11730)
  const makeObject = () => JSON.parse(JSON.stringify(base));
  return [makeObject(), makeObject(), makeObject()];
}

export function largeArrayWithSpreading() {
  // From issue #7116 - large arrays with spreading pattern
  const baseArray = Array.from({ length: 5 }, (_, i) => ({
    name: `item_${i}`,
    data: {
      arrays: [[], [], []],
      objects: [{}, {}, {}]
    }
  }));

  const arr = () => baseArray.map(x => ({
    ...x,
    extra: {
      arrays: [{ a: [] }, { b: [] }, { c: [] }],
      objects: [{ x: {} }, { y: {} }, { z: {} }]
    }
  }));

  // Spreading multiple times
  return [...arr(), ...arr(), ...arr()];
}