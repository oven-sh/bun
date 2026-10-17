export namespace util {
  export type MakePartial<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
  export interface P { x: number; y: number }
  type Hidden = P | undefined;
  export const origin: P = { x: 0, y: 0 };
  export function dist(a: P, b: Hidden = origin): number {
    return Math.hypot(a.x - (b?.x ?? 0), a.y - (b?.y ?? 0));
  }
  export namespace deep {
    export type Key = "a" | "b";
    export const keys: Key[] = ["a", "b"];
  }
}
export namespace onlyTypes {
  export type Id = string | number;
}
export namespace errors {
  export type Message = string | { message?: string };
  export const toObject = (message?: Message): { message?: string } => (typeof message === "string" ? { message } : message || {});
}
