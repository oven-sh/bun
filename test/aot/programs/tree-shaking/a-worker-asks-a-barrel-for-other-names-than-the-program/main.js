// start.js is the program and starts this file as a Worker. Both import from the barrel of one pure package: one name each of their own, one name both, and one name nobody. Every file of the package prints when it is evaluated, once in each thread that needs it.
import { forWorker, forBoth } from "shared-barrel";

self.onmessage = () => postMessage(forWorker() + ", " + forBoth());
