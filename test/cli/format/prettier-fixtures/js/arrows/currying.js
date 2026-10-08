const fn = b => c => d => {
  return 3;
};

const foo = (a, b) => c => d => {
  return 3;
};

const bar = a => b => c => a + b + c

const mw = store => next => action => {
  return next(action)
}

const middleware = options => (req, res, next) => {
  // ...
};
