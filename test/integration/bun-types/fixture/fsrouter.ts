import { FileSystemRouter } from "bun";
import { expectType } from "./utilities";

const options: Bun.FileSystemRouterOptions = {
  dir: "/pages",
  style: "nextjs",
};
const router = new FileSystemRouter(options);
expectType<string | null>(router.origin);
expectType<string | null>(router.assetPrefix);
expectType<FileSystemRouter>(router.reload());
expectType<"nextjs">(router.style);

const match = router.match("/");
expectType<string>(match?.name!);
expectType<string>(match?.pathname!);
expectType<string>(match?.scriptSrc!);
expectType<Record<string, string>>(match?.query!);
expectType<Record<string, string>>(match?.params!);
