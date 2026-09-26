/** One entry of the answer of `POST /-/npm/v1/security/advisories/bulk`. */
export interface Advisory {
  id: number;
  url: string;
  title: string;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  vulnerable_versions: string;
  cwe: string[];
  cvss: { score: number; vectorString: string | null };
}

export class Advisories {
  readonly #byPackage = new Map<string, Advisory[]>();
  #nextId = 1000000;

  /** Records an advisory against a package. Fields that are left out get the values of a typical advisory. */
  add(name: string, advisory: Partial<Advisory> & { vulnerable_versions: string }): Advisory {
    const id = advisory.id ?? this.#nextId++;
    const entry: Advisory = {
      id,
      url: `https://github.com/advisories/GHSA-${id}`,
      title: `Vulnerability in ${name}`,
      severity: "high",
      cwe: [],
      cvss: { score: 0, vectorString: null },
      ...advisory,
    };
    const advisories = this.#byPackage.get(name);
    if (advisories) advisories.push(entry);
    else this.#byPackage.set(name, [entry]);
    return entry;
  }

  clear() {
    this.#byPackage.clear();
  }

  /**
   * The bulk answer for a request of the form `{ "<name>": ["<version>", ...] }`. A package appears only when an
   * advisory covers one of the versions that the client listed.
   */
  lookup(request: Record<string, unknown>): Record<string, Advisory[]> {
    const found: Record<string, Advisory[]> = {};
    for (const [name, versions] of Object.entries(request)) {
      const advisories = this.#byPackage.get(name);
      if (!advisories || !Array.isArray(versions)) continue;
      const matching = advisories.filter(advisory =>
        versions.some(
          version => typeof version === "string" && Bun.semver.satisfies(version, advisory.vulnerable_versions),
        ),
      );
      if (matching.length > 0) found[name] = matching;
    }
    return found;
  }
}
