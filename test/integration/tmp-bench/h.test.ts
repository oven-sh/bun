import { tls } from "harness";
import { bench } from "./run";
process.env.STRESS_TLS = JSON.stringify(tls);
bench("stress-both.js");
