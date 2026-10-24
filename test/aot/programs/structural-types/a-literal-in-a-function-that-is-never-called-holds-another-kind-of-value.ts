interface Box {
  value: unknown;
}
function never(): Box {
  return { value: 7 };
}
const box: Box = { value: "text" };
console.log(box.value);
