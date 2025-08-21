// This is (for now) very loose implementation reference, mostly type testing

import { expectType } from "./utilities";

const mySecurityScanner: Bun.Security.Scanner = {
  version: "1",
  scan: async ({ packages }) => {
    const response = await fetch("https://threat-feed.example.com");

    if (!response.ok) {
      throw new Error("Unable to fetch threat feed");
    }

    // Would recommend using a schema library or something to validate here. You
    // should throw if the parsing fails rather than returning no advisories,
    // this code needs to be defensive...
    const myThreatFeed = (await response.json()) as Array<{
      package: string;
      version: string;
      url: string;
      description: string;
      category: "unhealthy" | "spam" | "malware"; // Imagine some other categories...
    }>;

    return myThreatFeed.flatMap((threat): Bun.Security.Advisory[] => {
      const match = packages.some(p => p.name === threat.package && p.version === threat.version);

      if (!match) {
        return [];
      }

      return [
        {
          level: threat.category === "malware" ? "fatal" : "warn",
          package: threat.package,
          url: threat.url,
          description: threat.description,
        },
      ];
    });
  },
};

expectType(mySecurityScanner).toBeDefined();
