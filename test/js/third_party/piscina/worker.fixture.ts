export default ({ a, b }: { a: number; b: number }) => {
  console.log("Worker: calculating", a, "+", b);
  return a + b;
};
