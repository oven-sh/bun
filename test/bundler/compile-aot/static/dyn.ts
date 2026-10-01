import { one, Base } from "./lib";
export default function (s: string) { return s + one + new Base().m(1) + `${""}`; }
