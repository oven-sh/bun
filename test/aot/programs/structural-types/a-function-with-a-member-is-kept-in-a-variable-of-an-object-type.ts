const both = Object.assign((): string => "called", { size: 3 });
const sized: { size: number } = both;
function read(): number {
  return sized.size;
}
console.log("size " + read());
