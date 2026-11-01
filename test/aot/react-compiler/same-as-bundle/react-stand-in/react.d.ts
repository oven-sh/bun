export function useMemo<T>(create: () => T, dependencies: readonly unknown[]): T;
export function useCallback<T>(callback: T, dependencies: readonly unknown[]): T;
export function memo<T>(component: T): T;
export function forwardRef<Props, Result>(component: (props: Props, ref: unknown) => Result): (props: Props) => Result;
export function createElement(type: unknown, props: unknown, ...children: unknown[]): string;
