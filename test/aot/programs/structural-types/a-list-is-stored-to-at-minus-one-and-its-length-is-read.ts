const numbers = [1, 2];
numbers[-1] = 3;
console.log(numbers.length);
console.log(numbers[-1]);
console.log(Object.keys(numbers).join());
console.log(-1 in numbers);

export {};
