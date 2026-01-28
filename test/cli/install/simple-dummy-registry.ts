import { Server, file } from "bun";
import { dirname, join } from "node:path";

const __dirname = dirname(Bun.fileURLToPath(import.meta.url));

export class SimpleRegistry {
  private debugLogs: boolean;
  private server: Server | null = null;
  private port: number = 0;
  public requestedUrls: string[] = [];
  private scannerBehavior: "clean" | "warn" | "fatal" = "clean";

  public static readonly packages: Record<string, [version: string]> = {
    "left-pad": ["1.3.0"],
    "is-even": ["1.0.0"],
    "is-odd": ["1.0.0"],
    "test-security-scanner": ["1.0.0"],
  };

  setScannerBehavior(behavior: "none" | "warn" | "fatal") {
    // ternary because it was originally called "clean" but I renamed it "none" and didnt want to update the .tgz files. easier this way
    this.scannerBehavior = behavior === "none" ? "clean" : behavior;
  }

  constructor(debugLogs: boolean) {
    this.debugLogs = debugLogs;
  }

  async start(): Promise<number> {
    const self = this;

    this.server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const pathname = url.pathname;

        self.requestedUrls.push(pathname);
        if (self.debugLogs) console.error(`[REGISTRY] ${req.method} ${pathname}`);

        if (pathname.startsWith("/") && !pathname.includes(".tgz")) {
          const packageName = decodeURIComponent(pathname.slice(1));
          return self.handleMetadata(packageName);
        }

        if (pathname.endsWith(".tgz")) {
          const match = pathname.match(/\/(.+)-(\d+\.\d+\.\d+)\.tgz$/);
          if (match) {
            const [, name, version] = match;
            return self.handleTarball(name, version);
          }
        }

        return new Response("Not found", { status: 404 });
      },
    });

    this.port = this.server.port!;
    return this.port;
  }

  stop() {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  private handleMetadata(packageName: string): Response {
    const versions = SimpleRegistry.packages[packageName];
    if (!versions) {
      return new Response("Package not found", { status: 404 });
    }

    const metadata = {
      name: packageName,
      versions: {},
      "dist-tags": {
        latest: versions[versions.length - 1],
      },
    };

    for (const version of versions) {
      metadata.versions[version] = {
        name: packageName,
        version: version,
        dist: {
          tarball: `http://localhost:${this.port}/${packageName}-${version}.tgz`,
        },
        dependencies: this.getDependencies(packageName, version),
      };
    }

    return new Response(JSON.stringify(metadata), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private getDependencies(packageName: string, _version: string) {
    if (packageName === "is-even") {
      return { "is-odd": "^1.0.0" };
    }
    if (packageName === "is-odd") {
      return { "is-even": "^1.0.0" };
    }
    return {};
  }

  private async handleTarball(name: string, version: string): Promise<Response> {
    const versions = SimpleRegistry.packages[name];

    if (!versions || !versions.includes(version)) {
      return new Response("Version not found", { status: 404 });
    }

    let tarballPath: string;
    if (name === "test-security-scanner") {
      tarballPath = join(__dirname, `${name}-${version}-${this.scannerBehavior}.tgz`);
    } else {
      tarballPath = join(__dirname, `${name}-${version}.tgz`);
    }

    try {
      const tarballFile = file(tarballPath);
      if (!tarballFile.size) {
        return new Response("Tarball not found", { status: 404 });
      }
      return new Response(tarballFile, {
        headers: {
          "Content-Type": "application/octet-stream",
        },
      });
    } catch (error) {
      if (this.debugLogs) console.error(`Failed to serve tarball ${tarballPath}:`, error);
      return new Response("Tarball not found", { status: 404 });
    }
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  clearRequestLog() {
    this.requestedUrls = [];
  }

  getRequestedPackages(): string[] {
    return this.requestedUrls
      .filter(url => !url.includes(".tgz") && url !== "/")
      .map(url => decodeURIComponent(url.slice(1)));
  }

  getRequestedTarballs(): string[] {
    return this.requestedUrls.filter(url => url.endsWith(".tgz"));
  }
}

let registry: SimpleRegistry | null = null;

export async function startRegistry(debugLogs: boolean): Promise<string> {
  registry = new SimpleRegistry(debugLogs);
  const port = await registry.start();
  return `http://localhost:${port}`;
}

export function stopRegistry() {
  if (registry) {
    registry.stop();
    registry = null;
  }
}

export function getRegistry(): SimpleRegistry | null {
  return registry;
}
