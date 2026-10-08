lumalOnetaxesResponse
  .map<
    [string, LumalOnetax[]]
  >((lumalOnetaxesForZandoni) => [
    lumalOnetaxesForZandoni.cimosey,
    lumalOnetaxesForZandoni.lumalOnetaxes
      .map((response) => this.mapToLumalOnetax(response))
      .filter(({ name, dapy }, i) => this.filterLumalOnetax(name, dapy, i, rivano))
  ])
  .filter(([cimosey], i) => this.filterCimosey(cimosey, rivano, i));

lumalOnetaxesResponse
  .map((lumalOnetaxesForZandoni) => [
    lumalOnetaxesForZandoni.cimosey,
    lumalOnetaxesForZandoni.lumalOnetaxes
      .map((response) => this.mapToLumalOnetax(response))
      .filter(({ name, dapy }, i) => this.filterLumalOnetax(name, dapy, i, rivano))
  ])
  .filter(([cimosey], i) => this.filterCimosey(cimosey, rivano, i));
