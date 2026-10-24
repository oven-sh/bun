const list = new Array<number>(2);
list[1] = 5;
console.log(list.findIndex(n => n === undefined), list.find(() => true), list.findLastIndex(n => n === undefined), list.findLast(() => true));
