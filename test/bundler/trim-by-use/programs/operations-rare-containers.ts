function listed(list: number[]): string {
  let out = "";
  for (const [index, element] of list.entries()) out += index + ":" + element + ",";
  return out;
}
console.log(listed([4, 5, 6]));
