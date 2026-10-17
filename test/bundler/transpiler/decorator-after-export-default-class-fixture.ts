export const decorated: string[] = [];

function decorator(target: any) {
  decorated.push(target.name);
  return class Replaced extends target {
    replaced = true;
  };
}

export default @decorator class DecoratedClass {}

export const binding = DecoratedClass;
