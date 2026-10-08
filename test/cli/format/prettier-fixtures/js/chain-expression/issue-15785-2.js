const theValue = Object.entries(someLongObjectName).filter(
  ([listingId]) => someListToCompareToHere?.includes(listingId),
);
const theValue2 = Object.entries(someLongObjectName).filter(
  ([listingId]) => someListToCompareToHere.includes(listingId),
);
