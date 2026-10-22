class Klass {
  method() { return "the method"; }
}
namespace Klass {
  export function helper() { return "the function of the merged namespace"; }
}
export = Klass;
