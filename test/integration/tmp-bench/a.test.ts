import { bench } from "./run";
bench("iobench.js", "--rounds", "3", "--only", "tcp ,http ,a message every");
