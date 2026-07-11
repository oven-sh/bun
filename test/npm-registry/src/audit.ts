/**
 * `POST /-/npm/v1/security/advisories/bulk` — the bulk-advisory
 * endpoint `npm audit` and `bun audit` use.
 *
 * Request body: `{ "<name>": ["<version>", ...], ... }` for everything
 * in the client's dependency tree. Response: the same keys, each
 * mapped to the list of advisories whose `vulnerable_versions` range
 * matches at least one of the requested versions. Packages with no
 * matching advisories are omitted entirely.
 */

import { json } from "./errors";

/** An advisory, shaped like registry.npmjs.org's bulk-advisory entries. */
export interface Advisory {
  id: number;
  /** The affected package name. */
  module_name: string;
  /** A semver range, e.g. `"<4.17.21"` or `">=1.0.0 <1.2.3"`. */
  vulnerable_versions: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  title: string;
  url: string;
  cwe?: string[];
  cvss?: { score: number; vectorString: string | null };
}

export class AdvisoryStore {
  readonly #byPackage = new Map<string, Advisory[]>();
  #nextId = 1_000_000;

  /**
   * Registers an advisory. `id` and `url` default to generated values
   * so a test only has to say what's vulnerable.
   */
  add(advisory: Omit<Advisory, "id" | "url"> & Partial<Pick<Advisory, "id" | "url">>): Advisory {
    const id = advisory.id ?? this.#nextId++;
    // Coalesce after the spread, like `id`: an explicit `url: undefined` must
    // fall back, not erase. `bun audit --ignore <GHSA>` matches on this URL.
    const url = advisory.url ?? `https://github.com/advisories/GHSA-${id}`;
    const complete: Advisory = { ...advisory, id, url };
    let list = this.#byPackage.get(complete.module_name);
    if (list === undefined) this.#byPackage.set(complete.module_name, (list = []));
    list.push(complete);
    return complete;
  }

  get size(): number {
    return this.#byPackage.size;
  }

  handleBulk(body: Record<string, string[]>): Response {
    const report: Record<string, Omit<Advisory, "module_name">[]> = {};
    for (const [name, versions] of Object.entries(body)) {
      const advisories = this.#byPackage.get(name);
      if (advisories === undefined || !Array.isArray(versions)) continue;
      const matched = advisories.filter(a => versions.some(v => Bun.semver.satisfies(v, a.vulnerable_versions)));
      // registry.npmjs.org does not repeat the package name per entry.
      if (matched.length > 0) report[name] = matched.map(({ module_name: _, ...rest }) => rest);
    }
    return json(report);
  }
}
