const groups = Map.groupBy([1, 2, 3], n => n % 2);
console.log(groups.get(1)?.length, groups.size);

export {};
