// https://babeljs.io/docs/babel-plugin-proposal-function-sent

function* generator() {
    console.log("Sent", function.sent);
    console.log("Yield", yield);
}

const iterator = generator();
iterator.next(1); // Logs "Sent 1"
iterator.next(2); // Logs "Yield 2"
