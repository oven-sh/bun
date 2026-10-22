function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Panel {
  width: number = 4;
  items: number[] = [1, 2];
  viaArrow(): number {
    const inner = (): number => this.width;
    return inner();
  }
  viaFunction(): string {
    const inner = function (this: unknown): string {
      return typeof this;
    };
    return inner();
  }
  viaCallbackArrow(): number[] {
    return this.items.map(item => item * this.width);
  }
  viaCallbackFunction(): string[] {
    return this.items.map(function (this: unknown): string {
      return typeof this;
    });
  }
  viaCallbackFunctionWithThis(): number[] {
    return this.items.map(function (this: Panel, item: number): number {
      return item * this.width;
    }, this);
  }
  makeReader(): () => number {
    return () => this.width;
  }
  makeWriter(): (n: number) => void {
    return n => {
      this.width = n;
    };
  }
  nestedObject(): number {
    const inner = {
      width: 400,
      read(): number {
        return this.width;
      },
      arrow: (): number => this.width,
    };
    return inner.read() + inner.arrow();
  }
  withDefault(n: number = this.width): number {
    return n;
  }
}

const panel = new Panel();
show("honest viaArrow", () => panel.viaArrow());
show("honest viaFunction", () => panel.viaFunction());
show("honest viaCallbackArrow", () => panel.viaCallbackArrow().join());
show("honest viaCallbackFunction", () => panel.viaCallbackFunction().join());
show("honest viaCallbackFunctionWithThis", () => panel.viaCallbackFunctionWithThis().join());
show("honest nestedObject", () => panel.nestedObject());
show("honest withDefault", () => panel.withDefault());

const { viaArrow, viaFunction, viaCallbackArrow, makeReader, makeWriter, nestedObject, withDefault } = panel;
show("bare viaArrow", () => viaArrow());
show("bare viaFunction", () => viaFunction());
show("bare viaCallbackArrow", () => viaCallbackArrow());
show("bare nestedObject", () => nestedObject());
show("bare withDefault", () => withDefault());
show("bare withDefault, given", () => withDefault(9));
show("bare makeReader does not throw", () => typeof makeReader());
show("what it made does", () => makeReader()());
show("what the bare makeWriter made", () => makeWriter()(5));

const like = { width: 40, items: [10] };
const reader = panel.makeReader.call(like);
const writer = panel.makeWriter.call(like);
show("a reader made for a look-alike", () => reader());
writer(41);
show("after its writer ran", () => reader() + " " + like.width + " " + panel.width);
show("viaCallbackArrow on a look-alike", () => panel.viaCallbackArrow.call(like).join());
show("viaCallbackFunctionWithThis on a look-alike", () => panel.viaCallbackFunctionWithThis.call(like).join());
show("nestedObject on a look-alike", () => panel.nestedObject.call(like));
show("withDefault on a look-alike", () => panel.withDefault.call(like));
show("withDefault on a wrong look-alike", () => panel.withDefault.call({ width: "wide" }));
const honestReader = panel.makeReader();
show("an honest reader, taken anywhere", () => [0].map(honestReader)[0]);
