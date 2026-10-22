// Every reference in an object takes 64 bits, as a program needs whose objects outgrow the 32 GB that 32-bit references reach.
import { variant } from "./run-programs";

variant("wide-references", ["--aot-huge-heap"], {}, 3, 3);
