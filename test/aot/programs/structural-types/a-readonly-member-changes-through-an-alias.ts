const fixed: { readonly size: number } = { size: 1 };
const loose: { size: number } = fixed;

console.log(fixed.size);
loose.size = 2;
console.log(fixed.size);

let sum = 0;
for (let i = 0; i < 10; i++) {
  sum += fixed.size;
  if (i === 4) loose.size = 100;
}
console.log(sum);

export {};
