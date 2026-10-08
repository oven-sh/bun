// https://babeljs.io/docs/babel-plugin-proposal-decorators

@annotation
class MyClass { }

function annotation(target) {
   target.annotated = true;
}

@isTestable(true)
class MyClass { }

function isTestable(value) {
   return function decorator(target) {
      target.isTestable = value;
   }
}

class C {
  @enumerable(false)
  method() { }
}

function enumerable(value) {
  return function (target, key, descriptor) {
     descriptor.enumerable = value;
     return descriptor;
  }
}
