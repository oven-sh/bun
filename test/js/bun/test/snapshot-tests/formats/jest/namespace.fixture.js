// Jest 30.5.2 wrote the snapshots with babel-jest and `presets: [["@babel/preset-env", { targets: { node: "current" } }]]`.
// That makes CommonJS of the three files, where an export that is not set yet is undefined. With native ES modules, Jest
// throws a ReferenceError for such an export and writes nothing.
const load = name => import(name).catch(error => error.namespace);

class Wrapped {
  constructor(inner) {
    this.inner = inner;
  }
}
class WrappedTheOlderWay {
  constructor(inner) {
    this.inner = inner;
  }
}
// Both forms of a serializer are handed the printer.
expect.addSnapshotSerializer({
  test: value => value instanceof Wrapped,
  serialize: (value, config, indentation, depth, refs, printer) =>
    `Wrapped(${printer(value.inner, config, indentation, depth, refs)})`,
});
expect.addSnapshotSerializer({
  test: value => value instanceof WrappedTheOlderWay,
  print: (value, print) => `WrappedTheOlderWay(${print(value.inner)})`,
});

describe("a module namespace with an export that is not set yet", () => {
  test("in a snapshot file", async () => {
    const namespace = await load("./unset-export.js");
    expect(namespace).toMatchSnapshot();
    expect({ namespace }).toMatchSnapshot();
    expect([namespace, new Map([["key", namespace]])]).toMatchSnapshot();
  });
  test("with property matchers", async () => {
    const namespace = await load("./unset-export.js");
    expect({ namespace, id: 1 }).toMatchSnapshot({ id: expect.any(Number) });
    expect(namespace).toMatchSnapshot({ hoisted: expect.any(Function) });
  });
  test("under the names that the printer reads", async () => {
    expect(await load("./unset-names.js")).toMatchSnapshot();
  });
  test("through the printer of a serializer", async () => {
    const namespace = await load("./unset-export.js");
    expect(new Wrapped(namespace)).toMatchSnapshot();
    expect(new WrappedTheOlderWay(namespace)).toMatchSnapshot();
    expect({ list: [new Wrapped({ namespace })] }).toMatchSnapshot();
  });
});
