import { same, renamed, becomesDefault, inObject, copied } from "./source";

export { same, renamed as other };
export default becomesDefault;
export const held = { inObject };
export const viaConst = copied;
