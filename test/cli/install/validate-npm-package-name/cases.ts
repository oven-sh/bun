export default {
  'some-package': { validForNewPackages: true, validForOldPackages: true },
  'example.com': { validForNewPackages: true, validForOldPackages: true },
  'under_score': { validForNewPackages: true, validForOldPackages: true },
  'period.js': { validForNewPackages: true, validForOldPackages: true },
  '123numeric': { validForNewPackages: true, validForOldPackages: true },
  'crazy!': { validForNewPackages: false, validForOldPackages: true },
  '@npm/thingy': { validForNewPackages: true, validForOldPackages: true },
  '@npm-zors/money!time.js': {
    validForNewPackages: false,
    validForOldPackages: true,
    warnings: ['name can no longer contain special characters ("~\'!()*")'],
  },
  '@user/node_modules': { validForNewPackages: true, validForOldPackages: true },
  '@user/_package': { validForNewPackages: true, validForOldPackages: true },
  '@user/http': { validForNewPackages: true, validForOldPackages: true },
  '': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['name length must be greater than zero'],
  },
  '.start-with-period': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['name cannot start with a period'],
  },
  '@npm/.': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['name cannot start with a period'],
  },
  '@npm/..': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['name cannot start with a period'],
  },
  '@npm/.package': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['name cannot start with a period'],
  },
  '_start-with-underscore': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['name cannot start with an underscore'],
  },
  'contain:colons': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['name can only contain URL-friendly characters'],
  },
  ' leading-space': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: [
      'name cannot contain leading or trailing spaces',
      'name can only contain URL-friendly characters',
    ],
  },
  'trailing-space ': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: [
      'name cannot contain leading or trailing spaces',
      'name can only contain URL-friendly characters',
    ],
  },
  's/l/a/s/h/e/s': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['name can only contain URL-friendly characters'],
  },
  'node_modules': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['node_modules is not a valid package name'],
  },
  'favicon.ico': {
    validForNewPackages: false,
    validForOldPackages: false,
    errors: ['favicon.ico is not a valid package name'],
  },
  'http': {
    validForNewPackages: false,
    validForOldPackages: true,
    warnings: ['http is a core module name'],
  },
  'process': {
    validForNewPackages: false,
    validForOldPackages: true,
    warnings: ['process is a core module name'],
  },
  'ifyouwanttogetthesumoftwonumberswherethosetwonumbersarechosenbyfindingthelargestoftwooutofthreenumbersandsquaringthemwhichismultiplyingthembyitselfthenyoushouldinputthreenumbersintothisfunctionanditwilldothatforyou-': {
    validForNewPackages: false,
    validForOldPackages: true,
    warnings: ['name can no longer contain more than 214 characters'],
  },
  'ifyouwanttogetthesumoftwonumberswherethosetwonumbersarechosenbyfindingthelargestoftwooutofthreenumbersandsquaringthemwhichismultiplyingthembyitselfthenyoushouldinputthreenumbersintothisfunctionanditwilldothatforyou': {
    validForNewPackages: true,
    validForOldPackages: true,
  },
};
