// Fixture for the prototype-chain walk of the auto-mocker: subclass statics,
// inherited prototype methods, and an exported instance must all keep their
// (mocked) API.

export class Base {
  static baseStatic() {
    return "base-static";
  }
  baseMethod() {
    return "base-method";
  }
}

export class Child extends Base {
  static childStatic() {
    return "child-static";
  }
  childMethod() {
    return "child-method";
  }
}

// A plain function used as a constructor; nothing reads its `prototype`
// before the mock, so it stays lazily unreified until the walker runs.
export function LegacyCtor() {}

export class Client {
  connect() {
    return "connected";
  }
  disconnect() {
    return "disconnected";
  }
}

export const client = new Client();
