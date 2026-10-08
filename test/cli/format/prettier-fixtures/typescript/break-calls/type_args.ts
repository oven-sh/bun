const response = something.$http.get<ThingamabobService.DetailsData>(
  `api/foo.ashx/foo-details/${myId}`,
  { cache: quux.httpCache, timeout }
);
