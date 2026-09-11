import { readFileSync } from "node:fs";
import { join } from "node:path";

const directory = join(import.meta.dirname, "ip-name-constraints");
const ipConstraintKey = readFileSync(join(directory, "leaf-key.pem"), "utf8");

export const ipConstraintCases = [
  ["ipv4-any", "ipv4", undefined],
  ["ipv4-subnet", "ipv4", undefined],
  ["ipv4-outside", "ipv4", "permitted subtree violation"],
  ["ipv4-excluded", "ipv4", "excluded subtree violation"],
  ["ipv4-excluded-other", "ipv4", undefined],
  ["ipv6-any", "ipv6", undefined],
  ["ipv6-subnet", "ipv6", undefined],
  ["ipv6-outside", "ipv6", "permitted subtree violation"],
  ["ipv6-excluded", "ipv6", "excluded subtree violation"],
  ["ipv6-excluded-other", "ipv6", undefined],
  ["dual-stack", "ipv4", undefined],
  ["dual-stack", "ipv6", undefined],
  ["ipv4-any", "ipv6", "permitted subtree violation"],
  ["ipv6-any", "ipv4", "permitted subtree violation"],
] as const;

export function ipConstraintCertificates(authority: string, family: string) {
  return {
    ca: readFileSync(join(directory, `${authority}-ca.pem`), "utf8"),
    cert: readFileSync(join(directory, `${family}-cert.pem`), "utf8"),
    key: ipConstraintKey,
  };
}
