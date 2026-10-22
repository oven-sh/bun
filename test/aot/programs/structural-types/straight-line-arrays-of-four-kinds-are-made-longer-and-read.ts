class Point {
  x = 1;
}

const integers = [1, 2];
integers.length = 3;
console.log(typeof integers[2]);
console.log(integers[2] + 1);
console.log(integers[2] | 0);
console.log(integers[2] === 0);

const fractions = [0.5];
fractions.length = 2;
console.log(typeof fractions[1]);
console.log(fractions[1] * 2);
console.log(fractions[1] === undefined);

const strings = ["a"];
strings.length = 2;
console.log(typeof strings[1]);
console.log(strings[1] + "!");
console.log(strings[1] === "");
try {
  console.log(strings[1].length);
} catch (error) {
  console.log(error instanceof TypeError);
}

const points = [new Point()];
points.length = 2;
console.log(typeof points[1]);
console.log(points[1] === null);
try {
  console.log(points[1].x);
} catch (error) {
  console.log(error instanceof TypeError);
}

const functions = [() => 1];
functions.length = 2;
console.log(typeof functions[1]);
try {
  console.log(functions[1]());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
