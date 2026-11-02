// This module imports itself. Until its last line runs, its export named `toString` is uninitialized.
import { format } from "node:util";
import * as self from "./namespace-with-uninitialized-toString-fixture.mjs";

export let thrown;
try {
  format("%s", self);
} catch (error) {
  thrown = error;
}

export const toString = () => "from the export";
