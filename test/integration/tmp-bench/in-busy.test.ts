import { bench } from "./run";
bench("cond.js", "busy", "stdin buffer,stdin sink,stdio ping-pong", ";12=65536;12=262144;8=262144;8=4194304;9=0");
