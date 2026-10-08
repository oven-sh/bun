// https://babeljs.io/docs/babel-plugin-proposal-class-properties

class Bork {
    //Property initializer syntax
    instanceProperty = "bork";
    boundFunction = () => {
      return this.instanceProperty;
    };

    //Static class properties
    static staticProperty = "babelIsCool";
    static staticFunction = function() {
      return Bork.staticProperty;
    };
  }

  let myBork = new Bork;

  //Property initializers are not on the prototype.
  console.log(myBork.__proto__.boundFunction); // > undefined

  //Bound functions are bound to the class instance.
  console.log(myBork.boundFunction.call(undefined)); // > "bork"

  //Static function exists on the class.
  console.log(Bork.staticFunction()); // > "babelIsCool"
