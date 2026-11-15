// The parts of a file with one gray block, whose samples are 128 + 5. It has no DHT, so it uses the tables of K.3.
import { eights, flat } from "./decode";
import { coded, dqt, jpeg, scanOf, sof, typical } from "./write";

export const gray = flat([[5]]);
export const [quant, frame] = [dqt(0, eights), sof(gray)];
export const { header, data } = coded(gray, scanOf([0]), typical);
export const scan = Buffer.concat([header, data]);
/** The file with `parts` after SOI, or before EOI. */
export const before = (...parts: Buffer[]) => jpeg(...parts, quant, frame, scan);
export const after = (...parts: Buffer[]) => jpeg(quant, frame, scan, ...parts);
