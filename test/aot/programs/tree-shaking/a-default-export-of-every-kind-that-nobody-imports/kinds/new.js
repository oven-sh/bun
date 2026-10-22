import { effect } from "../log.js";
export const named = "j";
export default new (class { constructor() { effect("a constructor"); } })();
