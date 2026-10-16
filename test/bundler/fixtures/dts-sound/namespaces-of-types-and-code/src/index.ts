import { errors, util } from "./util";
import type { onlyTypes } from "./util";
export { util };
export type Loose = util.MakePartial<util.P, "y">;
export function far(point: util.P, key: util.deep.Key, id: onlyTypes.Id): number {
  return util.dist(point) + util.deep.keys.indexOf(key) + String(id).length;
}
export function explain(message?: errors.Message): string | undefined {
  return errors.toObject(message).message;
}
