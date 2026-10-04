import { one } from "tiny";
import { Counter } from "./counter";

const counter = new Counter();
console.log(counter.half(4), counter.half(6), one);
