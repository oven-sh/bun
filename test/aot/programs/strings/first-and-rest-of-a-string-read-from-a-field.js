// `const [first, ...rest] = value` gets a string out of a field a thousand times. Later the same line gets a proxy of an array, an array with holes and an array of objects.
class Box {
  constructor(content) {
    this.content = content;
  }
}

function split(value) {
  const [first, ...rest] = value;
  return [first, rest];
}

function splitContent(box) {
  return split(box.content);
}

function show(content) {
  return JSON.stringify(splitContent(new Box(content)));
}

let answer = "";
for (let round = 0; round < 1000; round++) answer = show("abcd");
console.log(answer);
console.log(show(new Proxy([1, 2, 3], {})));
console.log(show([, 2, , 4]));
console.log(show([{ a: 1 }, { b: 2 }]));
console.log(show("é☃z"), show(""), show("abcd"));
