const groups = Map.groupBy([1, 2, 3], n => n % 2);
let total = 0;
for (const [key, list] of groups) total += key + list.length;
console.log(total);

export {};
