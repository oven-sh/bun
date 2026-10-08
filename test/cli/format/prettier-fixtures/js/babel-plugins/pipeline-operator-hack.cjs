// https://babeljs.io/docs/babel-plugin-proposal-pipeline-operator
// https://github.com/js-choi/proposal-hack-pipes

return list
 |> take(prefix.length, %)
 |> equals(%, prefix);

// (The % token isn't final; it might instead be @ or ? or #.)
