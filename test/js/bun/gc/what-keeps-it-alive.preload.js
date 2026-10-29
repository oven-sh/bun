// Preloaded in front of a program that prints "alive" when an Inflate outlived its last reference: the run then says what holds it.
// The program stays as it is, to the letter. Where a stale word lies goes by the code of the functions on the stack.
const { whatKeepsAlive } = require("./what-keeps-it-alive.fixture.js");
const { log } = console;
console.log = text => {
  log(text);
  if (text !== "alive") return;
  try {
    console.error(whatKeepsAlive("Inflate"));
  } catch (error) {
    console.error(`${error}`);
  }
};
