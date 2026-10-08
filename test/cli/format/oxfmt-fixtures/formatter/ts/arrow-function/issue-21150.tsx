const AppWrapper = <Options = any,>({
  appName,
}: {
  appName: string;
}) => null;

const getProps = <T = Record<string, unknown>,>(
  option: T | undefined,
): Partial<T> => ({});
