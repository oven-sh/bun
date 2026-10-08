// https://babeljs.io/docs/babel-plugin-proposal-pipeline-operator
// https://github.com/tc39/proposal-pipeline-operator/

let result = exclaim(capitalize(doubleSay("hello")));
result //=> "Hello, hello!"

let result = "hello"
  |> doubleSay
  |> capitalize
  |> exclaim;

result //=> "Hello, hello!"
