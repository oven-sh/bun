function first(constructor) { return constructor.$1; }
function whole(constructor, a, b) { const text = constructor.lastMatch; return a + ":" + text + ":" + b; }
function shouted(constructor) { return constructor.$2.toUpperCase(); }
function lengthOfInput(constructor) { return constructor.input.length; }
function tried(receiver) {
    try {
        return "value " + receiver.$1;
    } catch (error) {
        return error.constructor.name;
    }
}

const pattern = /(\w+)-(\w+)/;
const texts = ["alpha-beta", "gamma-delta", "one-two three", "x-y"];
const lines = [];
for (let round = 0; round < 12; round++) {
    pattern.exec(texts[round & 3]);
    lines.push([first(RegExp), whole(RegExp, round, round + 1), shouted(RegExp), lengthOfInput(RegExp)].join(" "));
}
console.log(lines.join("\n"));

const heir = Object.create(RegExp);
const answers = [];
for (let round = 0; round < 8; round++) answers.push(tried(round & 1 ? heir : RegExp));
console.log(answers.join(" | "));

for (let round = 0; round < 6; round++) {
    RegExp.input = "stored " + round;
    console.log(lengthOfInput(RegExp), RegExp.input, RegExp.$_);
}

const plain = { $1: "own", lastMatch: "mine", $2: "two", input: "abc" };
for (let round = 0; round < 6; round++) {
    const receiver = round % 3 === 2 ? plain : RegExp;
    console.log(first(receiver), whole(receiver, 1, 2), shouted(receiver), lengthOfInput(receiver));
}

RegExp.extra = 1;
pattern.exec("late-comer");
for (let round = 0; round < 4; round++) console.log(first(RegExp), whole(RegExp, 3, 4), shouted(RegExp), lengthOfInput(RegExp));
delete RegExp.extra;
for (let round = 0; round < 4; round++) console.log(first(RegExp), shouted(RegExp));
