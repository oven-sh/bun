const foo = (): () => void => (): void => null;
const bar = (): (() => void) => (): void => null;
const baz = (): ((() => void)) => (): void => null;
