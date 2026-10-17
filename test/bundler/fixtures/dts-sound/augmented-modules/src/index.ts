import { annotate } from "./schema";
declare module "./schema" {
  namespace Annotations {
    interface Augment {
      readonly status?: number;
    }
  }
  interface Options {
    readonly loud?: boolean;
  }
}
export function status(code: number): string[] {
  return annotate({ status: code, title: "status" }, { loud: true });
}
