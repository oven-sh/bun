export function countriesReceived(countries: Array<Country>): CountryActionType {
  return {
    type: ActionTypes.COUNTRIES_RECEIVED,
    countries: countries,
  };
}
