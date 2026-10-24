// A helper throws what it was passed, what it read out of it, what a callback threw, or lets a getter's exception through.
function raise(value) {
  throw value;
}
function raiseFirst(array) {
  throw array[0];
}
function guard(callback, value) {
  try {
    return callback(value);
  } catch (error) {
    return { caught: error };
  }
}
function read(object) {
  return object.value;
}
class Problem {
  constructor(code) {
    this.code = code;
  }
}
class Note {
  constructor(text) {
    this.text = text;
  }
}
const lines = [];
function attempt(f, ...operands) {
  try {
    return "answered " + String(f(...operands));
  } catch (error) {
    if (error instanceof Problem) return "problem " + error.code;
    if (error instanceof Note) return "note " + error.text;
    return "other " + typeof error + " " + String(error);
  }
}
for (let i = 0; i < 3; i++) {
  lines.push(attempt(raise, new Problem(i)), attempt(raise, new Note("n" + i)), attempt(raise, i), attempt(raise, undefined));
  lines.push(attempt(raiseFirst, [new Note("first")]), attempt(raiseFirst, [new Problem(9)]), attempt(raiseFirst, []), attempt(raiseFirst, "text"));
  lines.push(String(guard(raise, new Problem(i)).caught.code), String(guard(raise, new Note("g")).caught.text), String(guard(x => x + 1, i)));
  lines.push(attempt(read, { value: i }), attempt(read, { get value() { throw new Problem(100 + i); } }), attempt(read, { get value() { throw new Note("getter"); } }), attempt(read, null).slice(0, 12));
}
console.log(lines.join("\n"));
