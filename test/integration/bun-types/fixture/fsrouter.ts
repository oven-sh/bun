import { FileSystemRouter } from "bun";
import { expectType } from "./utilities";

const router = new FileSystemRouter({
  dir: "/pages",
  style: "nextjs",
});

const match = router.match("/");
expectType<string>(match?.name!);
expectType<string>(match?.pathname!);
expectType<Record<string, string>>(match?.query!);
expectType<Record<string, string>>(match?.params!);
