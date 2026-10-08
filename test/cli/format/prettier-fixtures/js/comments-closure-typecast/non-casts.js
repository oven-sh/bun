/* @type { } */
z(x => {
  (foo)((bar)(2+(3)))
  return (1);
})

/** @type { } */
z(x => {
  (foo)((bar)(2+(3)))
  return (1);
})

/** @type {number} */
let q = z(x => {
  return (1);
})

const w1 = /** @typefoo Foo */ (value);
