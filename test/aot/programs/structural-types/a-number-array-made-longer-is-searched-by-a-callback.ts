const longer: number[] = [1, 2, 3];
longer.length = 4;
console.log(longer.findIndex(n => n === undefined));

export {};
