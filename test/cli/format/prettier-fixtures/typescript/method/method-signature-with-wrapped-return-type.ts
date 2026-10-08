type ReleaseToolConfig = {
  get(key: "changelog"): {
    get(key: "repo"): string;
    get(key: "labels"): Map<string, string>;
  };
};

type ReleaseToolConfig2 = {
  get(key: "changelog"): `
  `
};
