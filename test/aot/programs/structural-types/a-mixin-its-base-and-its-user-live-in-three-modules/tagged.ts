export function Tagged<T extends object>(Base: new () => T) {
  const Parent: new () => object = Base;
  return class extends Parent {
    tag = "tagged";
  };
}
