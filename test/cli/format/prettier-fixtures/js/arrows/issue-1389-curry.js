const foobar = (argumentOne, argumentTwo, argumentThree) =>
  (...restOfTheArguments) => {
    return "baz";
  };

const foobaz = (argumentOne, argumentTwo, argumentThree) =>
  (restOfTheArguments123, j) => {
    return "baz";
  };


const makeSomeFunction =
  (services = {logger:null}) =>
    (a, b, c) =>
      services.logger(a,b,c)

const makeSomeFunction2 =
  (services = {
    logger: null
  }) =>
    (a, b, c) =>
      services.logger(a, b, c)
