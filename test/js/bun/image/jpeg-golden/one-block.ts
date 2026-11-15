// A file of one block, 5 above the middle, in parts.
import { eights, flat } from "./decode";
import { coded, dqt, jpeg, scanOf, sof, typical, type Frame, type Scan } from "./write";

export const gray = flat([[5]]);
export const [steps, frame] = [dqt(0, eights), sof(gray)];
export const { header, data } = coded(gray, scanOf([0]), typical);
export const scan = Buffer.concat([header, data]);
export const before = (...parts: Buffer[]) => jpeg(...parts, steps, frame, scan);
export const behind = (...parts: Buffer[]) => jpeg(steps, frame, scan, ...parts);
/** The header of a scan and its data, in the tables that there are without DHT. */
export const scanned = (frame: Frame, scan: Scan) => {
  const { header, data } = coded(frame, scan, typical);
  return Buffer.concat([header, data]);
};
