const written: number[] = [1, 2, 3];
Reflect.set(written, 1, undefined);
console.log(written.some(n => n === undefined));
console.log(written.filter(n => n === undefined).length);
console.log(written.every(n => n !== undefined));

const text: number[] = [1, 2, 3];
Reflect.set(text, 1, "text");
console.log(text.some(n => typeof n === "string"));
console.log(text.every(n => typeof n === "number"));
console.log(text.map(n => n + 1).join());

export {};
