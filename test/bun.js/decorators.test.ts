import { test, expect } from "bun:test";

test("decorator order of evaluation", () => {
  let counter = 0;
  const computedProp: unique symbol = Symbol("computedProp");

  @decorator1
  @decorator2
  class BugReport {
    @decorator7
    type: string;

    @decorator3
    x: number = 20;

    @decorator5
    private _y: number = 12;

    @decorator10
    get y() {
      return this._y;
    }
    @decorator11
    set y(newY: number) {
      this._y = newY;
    }

    @decorator9
    [computedProp]: string = "yes";

    constructor(@decorator8 type: string) {
      this.type = type;
    }

    @decorator6
    move(newX: number, @decorator12 newY: number) {
      this.x = newX;
      this._y = newY;
    }

    @decorator4
    jump() {
      this._y += 30;
    }
  }

  let d = new BugReport("bad bug");

  function decorator1(target, propertyKey) {
    expect(counter++).toBe(11);
    expect(target === BugReport).toBe(true);
    expect(propertyKey).toBe(undefined);
  }

  function decorator2(target, propertyKey) {
    expect(counter++).toBe(10);
    expect(target === BugReport).toBe(true);
    expect(propertyKey).toBe(undefined);
  }

  function decorator3(target, propertyKey) {
    expect(counter++).toBe(1);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("x");
  }

  function decorator4(target, propertyKey) {
    expect(counter++).toBe(8);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("jump");
  }

  function decorator5(target, propertyKey) {
    expect(counter++).toBe(2);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("_y");
  }

  function decorator6(target, propertyKey) {
    expect(counter++).toBe(7);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("move");
  }

  function decorator7(target, propertyKey) {
    expect(counter++).toBe(0);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("type");
  }

  function decorator8(target, propertyKey) {
    expect(counter++).toBe(9);
    expect(target === BugReport).toBe(true);
    expect(propertyKey).toBe(undefined);
  }

  function decorator9(target, propertyKey) {
    expect(counter++).toBe(5);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe(computedProp);
  }

  function decorator10(target, propertyKey) {
    expect(counter++).toBe(3);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("y");
  }

  function decorator11(target, propertyKey) {
    expect(counter++).toBe(4);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("y");
  }

  function decorator12(target, propertyKey) {
    expect(counter++).toBe(6);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("move");
  }
});

test("decorator factories order of evaluation", () => {
  let counter = 0;
  const computedProp: unique symbol = Symbol("computedProp");

  @decorator1()
  @decorator2()
  class BugReport {
    @decorator7()
    type: string;

    @decorator3()
    x: number = 20;

    @decorator5()
    private _y: number = 12;

    @decorator10()
    get y() {
      return this._y;
    }
    @decorator11()
    set y(newY: number) {
      this._y = newY;
    }

    @decorator9()
    [computedProp]: string = "yes";

    constructor(@decorator8() type: string) {
      this.type = type;
    }

    @decorator6()
    move(newX: number, @decorator12() newY: number) {
      this.x = newX;
      this._y = newY;
    }

    @decorator4()
    jump() {
      this._y += 30;
    }
  }

  let d = new BugReport("bad bug");

  function decorator1() {
    expect(counter++).toBe(18);
    return function (target, descriptorKey) {
      expect(counter++).toBe(23);
    };
  }

  function decorator2() {
    expect(counter++).toBe(19);
    return function (target, descriptorKey) {
      expect(counter++).toBe(22);
    };
  }

  function decorator3() {
    expect(counter++).toBe(2);
    return function (target, descriptorKey) {
      expect(counter++).toBe(3);
    };
  }

  function decorator4() {
    expect(counter++).toBe(16);
    return function (target, descriptorKey) {
      expect(counter++).toBe(17);
    };
  }

  function decorator5() {
    expect(counter++).toBe(4);
    return function (target, descriptorKey) {
      expect(counter++).toBe(5);
    };
  }

  function decorator6() {
    expect(counter++).toBe(12);
    return function (target, descriptorKey) {
      expect(counter++).toBe(15);
    };
  }

  function decorator7() {
    expect(counter++).toBe(0);
    return function (target, descriptorKey) {
      expect(counter++).toBe(1);
    };
  }

  function decorator8() {
    expect(counter++).toBe(20);
    return function (target, descriptorKey) {
      expect(counter++).toBe(21);
    };
  }

  function decorator9() {
    expect(counter++).toBe(10);
    return function (target, descriptorKey) {
      expect(counter++).toBe(11);
    };
  }

  function decorator10() {
    expect(counter++).toBe(6);
    return function (target, descriptorKey) {
      expect(counter++).toBe(7);
    };
  }

  function decorator11() {
    expect(counter++).toBe(8);
    return function (target, descriptorKey) {
      expect(counter++).toBe(9);
    };
  }

  function decorator12() {
    expect(counter++).toBe(13);
    return function (target, descriptorKey) {
      expect(counter++).toBe(14);
    };
  }
});

test("class decorators", () => {
  @decorator1
  class BugReport {
    #x: number = 20;
    type: string = "default";
    private static someting: number = 10;
    static anotherStatic: boolean;

    constructor(type: string) {
      this.type = type;
    }
  }

  let d = new BugReport("bad bug");

  function decorator1(target) {
    expect(target === BugReport).toBe(true);
  }
});

// test("method decorators", () => {
//   class M {
//     @decorator1()
//     @decorator2()
//     method() {}
//   }

//   function decorator1() {
//     console.log("decorator1() evaluated");
//     return function (
//       target: any,
//       propertyKey: string,
//       descriptor: PropertyDescriptor
//     ) {
//       console.log("decorator1() called");
//     };
//   }

//   function decorator2() {
//     console.log("decorator2() evaluated");
//     return function (
//       target: any,
//       propertyKey: string,
//       descriptor: PropertyDescriptor
//     ) {
//       console.log("decorator2() called");
//     };
//   }
// });

// test("parameter decorators", () => {});

// test("accessor decorators", () => {});

// test("decorator factories", () => {
//   class T {
//     @color("red")
//     c: string = "blue";
//     x: number = 10;

//     constructor(x: number) {
//       this.x = x;
//     }
//   }

//   function color(value: string) {
//     return function (target: any, propertyKey) {
//       expect(propertyKey).toBe("c");
//     };
//   }
// });

// test("decorator composition", () => {});

// test("decorator metadata", () => {});
