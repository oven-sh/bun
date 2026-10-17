import type { Input, Result } from "../types";
import { Request } from "../request";
export function stream(request: Request<Input>, result: Result<number>): number {
  return result.value + request.cached;
}
