export const decorated: any[] = [];

function decorator(target: any) {
  decorated.push(target);
}

export default @decorator class {
  method() {
    return 42;
  }
}
