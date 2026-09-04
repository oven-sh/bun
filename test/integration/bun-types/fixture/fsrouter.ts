import { FileSystemRouter } from "bun";
import { expectType } from "./utilities";

const router = new FileSystemRouter({
  dir: "/pages",
  style: "nextjs",
});

const match = router.match("/");
expectType<string>(match?.name!);
// scriptSrc is the runtime's legacy name for src.
expectType<string>(match?.src!);
expectType<string>(match?.scriptSrc!);
expectType<string>(match?.pathname!);
expectType<Record<string, string>>(match?.query!);
expectType<Record<string, string>>(match?.params!);
