import { expectNotEmpty } from "./utilities";

expectNotEmpty<RequestInit>();
expectNotEmpty<ResponseInit>();

// @ts-expect-error Should fail
expectNotEmpty<{}>();
