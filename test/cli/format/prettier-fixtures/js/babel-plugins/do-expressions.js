// https://babeljs.io/docs/babel-plugin-proposal-do-expressions

let a = do {
  if(x > 10) {
    'big';
  } else {
    'small';
  }
};
// is equivalent to:
let a = x > 10 ? 'big' : 'small';
