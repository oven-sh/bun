type HasLength = { length: number };

function pick(which: number): HasLength {
  if (which === 0) return { length: 10 };
  return [1, 2, 3];
}

console.log("literal", pick(0).length);
console.log("array", pick(1).length);
