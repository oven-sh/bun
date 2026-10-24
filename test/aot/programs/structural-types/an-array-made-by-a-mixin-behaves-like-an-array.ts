function Tagged(Base: new (...items: number[]) => number[]) {
  return class extends Base {
    tag = "tagged";
  };
}

const Made = Tagged(Array<number>);
const list = new Made();
list.push(1, 2);
list[4] = 5;
console.log("length " + list.length + " keys " + Object.keys(list).join(" ") + " json " + JSON.stringify(list) + " isArray " + Array.isArray(list));
list.length = 2;
console.log("shortened: " + list.join("+") + " keys " + Object.keys(list).join(" "));
const mapped = list.map(n => n * 2);
console.log("mapped: " + mapped.join("+") + " same class " + (mapped instanceof Made) + " keys " + Object.keys(mapped).join(" "));
const sliced = list.slice(1);
console.log("sliced: " + sliced.join("+") + " same class " + (sliced instanceof Made) + " length " + sliced.length);
console.log("concat: " + [0].concat(list).join("+") + " spread: " + [...list].join("+") + " from: " + Array.from(list).join("+"));
const [first, second, third] = list;
console.log("destructured: " + first + " " + second + " " + third);
let sum = 0;
for (const n of list) sum += n;
for (let i = 0; i < list.length; i++) sum += list[i];
console.log("summed twice: " + sum);
console.log("three: " + new Made(3).length + " one two: " + new Made(1, 2).join("+"));
