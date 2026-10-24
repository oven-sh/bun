// Many kinds of objects are asked for the same names by the same code.
function make(i) {
  const o = {};
  o["kind" + i] = i;
  o.first = i; o.second = 2; o.third = 3; o.fourth = 4; o.fifth = 5; o.sixth = 6; o.seventh = 7; o.eighth = 8;
  return o;
}
function read(o) { return o.first + o.second * 2 + o.third * 3 + o.fourth * 5 + o.fifth * 7 + o.sixth * 11 + o.seventh * 13 + o.eighth * 17 + (o.ninth === undefined ? 19 : 0) + (o.toString !== undefined ? 23 : 0); }
const objects = [];
for (let i = 0; i < 1500; i++) objects.push(make(i));
let sum = 0;
for (const o of objects) sum = sum + read(o) | 0;
console.log("1500 kinds, ten names of each:", sum);
for (const o of objects) sum = sum + read(o) | 0;
console.log(sum);
