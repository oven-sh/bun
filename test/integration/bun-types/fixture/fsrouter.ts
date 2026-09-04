import { FileSystemRouter } from "bun";
import { expectType } from "./utilities";

const router = new FileSystemRouter({
  dir: "/pages",
  style: "nextjs",
});

// null when the router was constructed without an origin.
expectType(router.origin).is<string | null>();

const match = router.match("/");
expectType<string>(match?.name!);
expectType<string>(match?.pathname!);
// A query string name given more than once maps to an array of its values.
expectType(match?.query!).is<Record<string, string | string[]>>();
for (const value of Object.values(match!.query)) {
  if (Array.isArray(value)) expectType(value).is<string[]>();
  else expectType(value).is<string>();
}
expectType<Record<string, string>>(match?.params!);
