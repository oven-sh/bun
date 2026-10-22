import vm from "node:vm";

const list: number[] = vm.runInNewContext("[1, 2, 3]");
console.log(list.length, Array.isArray(list), list instanceof Array, list[0] + list[2]);
