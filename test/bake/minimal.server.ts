import { Bake } from "bun";

export function render(req: Request, meta: Bake.RouteMetadata) {
  if (typeof meta.pageModule.default !== "function") {
    console.log("pageModule === ", meta.pageModule);
    throw new Error("Expected default export to be a function");
  }
  return meta.pageModule.default(req, meta);
}

export function registerClientReference(value: any, file: any, uid: any) {
  return {
    value,
    file,
    uid,
  };
}
