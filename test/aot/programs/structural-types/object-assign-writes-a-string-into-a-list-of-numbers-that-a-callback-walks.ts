const list: number[] = [1, 2, 3];
Object.assign(list, { 0: "text" });
console.log(list.map(n => n + 1).join());

export {};
