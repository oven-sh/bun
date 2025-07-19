import { expect } from "bun:test";

expect("a\nb\nc\n d\ne").toEqual("a\nd\nc\nd\ne");
