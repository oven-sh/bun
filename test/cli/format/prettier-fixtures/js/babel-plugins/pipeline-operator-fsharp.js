// https://babeljs.io/docs/babel-plugin-proposal-pipeline-operator
// https://github.com/valtech-nyc/proposal-fsharp-pipelines

promise
  |> await
  |> x => doubleSay(x, ', ')
  |> capitalize
  |> x => x + '!'
  |> x => new User.Message(x)
  |> x => stream.write(x)
  |> await
  |> console.log;

const result = exclaim(capitalize(doubleSay("hello")));
result //=> "Hello, hello!"

const result = "hello"
  |> doubleSay
  |> capitalize
  |> exclaim;

result //=> "Hello, hello!"

const person = { score: 25 };

const newScore = person.score
  |> double
  |> n => add(7, n)
  |> n => boundScore(0, 100, n);

newScore //=> 57

// As opposed to:
let newScore = boundScore(0, 100, add(7, double(person.score)));
