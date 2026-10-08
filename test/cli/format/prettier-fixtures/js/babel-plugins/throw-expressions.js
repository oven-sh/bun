// https://babeljs.io/docs/babel-plugin-proposal-throw-expressions

function test(param = throw new Error('required!')) {
  const test = param === true || throw new Error('Falsy!');
}
