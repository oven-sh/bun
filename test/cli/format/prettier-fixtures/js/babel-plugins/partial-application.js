// https://babeljs.io/docs/babel-plugin-proposal-partial-application

function add(x, y) { return x + y; }

const addOne = add(1, ?); // apply from the left
addOne(2); // 3

const addTen = add(?, 10); // apply from the right
addTen(2); // 12

let newScore = player.score
  |> add(7, ?)
  |> clamp(0, 100, ?); // shallow stack, the pipe to `clamp` is the same frame as the pipe to `add`.

f(x, ?)           // partial application from left
f(?, x)           // partial application from right
f(?, x, ?)        // partial application for any arg
o.f(x, ?)         // partial application from left
o.f(?, x)         // partial application from right
o.f(?, x, ?)      // partial application for any arg
super.f(?)        // partial application allowed for call on |SuperProperty|
