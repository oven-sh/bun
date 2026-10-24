class Base {
  made = "mq";
}
function Named(Parent: new () => Base) {
  return class extends Parent {
    middle: string;
    constructor() {
      super();
      this.middle = "dq";
    }
  };
}
const A = Named(Base);
const B = Named(Base);
console.log("zq a [" + Object.keys(new A()).join(" ") + "]");
console.log("zq b [" + Object.keys(new B()).join(" ") + "]");
