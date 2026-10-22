const point = { x: 1, y: 2 };
[point].forEach(Object.freeze);
console.log(Object.isFrozen(point));
try {
  point.x = 5;
  console.log("stored");
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
