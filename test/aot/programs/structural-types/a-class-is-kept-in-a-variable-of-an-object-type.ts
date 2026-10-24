class Box {
  static size: number = 6;
}
const sized: { size: number } = Box;
function read(): number {
  return sized.size;
}
console.log("size " + read());
