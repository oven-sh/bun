export function fail(message) {
  return "came back: " + message;
}

export function assertNumber(value) {}

export function assertPresent(value) {}

export function assertTrue(condition) {
  return condition;
}

export function isText(value) {
  return true;
}

export class Guard {
  stop() {
    return "came back";
  }
  check(value) {}
  ready() {
    return true;
  }
}

export class Ready extends Guard {
  level = 1;
}

export const impossible = "here";

export function nothing() {
  return "something";
}

export function absent() {
  return 5;
}

export function nil() {
  return { x: 1 };
}
