import { expectType } from "./utilities";

async function example(): Promise<Blob> {
  const response = await fetch("foo");
  return await response.blob();
}

import { Blob as NodeBlob } from "node:buffer";
async function example2(): Promise<NodeBlob> {
  const response = await fetch("foo");
  return await response.blob();
}

expectType(Blob.prototype).extends<{
  json(): Promise<unknown>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
}>();

expectType(new Blob(["hello"])).extends<{
  json(): Promise<unknown>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  formData(): Promise<FormData>;
}>();
