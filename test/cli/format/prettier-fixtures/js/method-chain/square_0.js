const version = someLongString
  .split('jest version =')
  .pop()
  .split(EOL)[0]
  .trim();

const component = find('.org-lclp-edit-copy-url-banner__link')[0]
  .getAttribute('href')
  .indexOf(this.landingPageLink);
