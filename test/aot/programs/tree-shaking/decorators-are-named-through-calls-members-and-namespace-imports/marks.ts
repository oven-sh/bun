export const log: string[] = [];

export function imported(value: Function, context: ClassDecoratorContext): void {
  log.push("imported");
}

export function factory(text: string) {
  return (value: Function, context: ClassDecoratorContext): void => {
    log.push("factory " + text);
  };
}

export function unused(): void {
  log.push("unused");
}
