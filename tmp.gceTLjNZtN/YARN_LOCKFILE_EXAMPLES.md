# Yarn v1 Lockfile Real Examples

This file contains real entries from the generated yarn.lock to illustrate key patterns.

## 1. Simple Package with No Dependencies

```yaml
wrappy@1:
  version "1.0.2"
  resolved "https://registry.yarnpkg.com/wrappy/-/wrappy-1.0.2.tgz#b5243d8f3ec1aa35f1364605bc0d1036e30ab69f"
  integrity sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==
```

## 2. Package with Dependencies

```yaml
chalk@^4.0.0, chalk@^4.1.2:
  version "4.1.2"
  resolved "https://registry.yarnpkg.com/chalk/-/chalk-4.1.2.tgz#aac4e2b7734a740867aeb16bf02aad556a1e7a01"
  integrity sha512-oKnbhFyRIXpUuez8iBMmyEa4nbj4IOQyuhc/wy9kY7/WVPcwIO9VA668Pu8RkO7+0G76SLROeyw9CpQ061i4mA==
  dependencies:
    ansi-styles "^4.1.0"
    supports-color "^7.1.0"
```

## 3. Scoped Package with Many Dependencies

```yaml
"@babel/core@^7.11.6", "@babel/core@^7.12.3", "@babel/core@^7.23.9":
  version "7.28.4"
  resolved "https://registry.yarnpkg.com/@babel/core/-/core-7.28.4.tgz#12a550b8794452df4c8b084f95003bce1742d496"
  integrity sha512-2BCOP7TN8M+gVDj7/ht3hsaO/B/n5oDbiAyyvnRlNOs+u1o+JWNYTQrmpuNp1/Wq2gcFrI01JAW+paEKDMx/CA==
  dependencies:
    "@babel/code-frame" "^7.27.1"
    "@babel/generator" "^7.28.3"
    "@babel/helper-compilation-targets" "^7.27.2"
    "@babel/helper-module-transforms" "^7.28.3"
    "@babel/helpers" "^7.28.4"
    "@babel/parser" "^7.28.4"
    "@babel/template" "^7.27.2"
    "@babel/traverse" "^7.28.4"
    "@babel/types" "^7.28.4"
    "@jridgewell/remapping" "^2.3.5"
    convert-source-map "^2.0.0"
    debug "^4.1.0"
    gensync "^1.0.0-beta.2"
    json5 "^2.2.3"
    semver "^6.3.1"
```

## 4. Multiple Version Ranges Deduplicated

```yaml
"@babel/helper-plugin-utils@^7.0.0", "@babel/helper-plugin-utils@^7.10.4", "@babel/helper-plugin-utils@^7.12.13", "@babel/helper-plugin-utils@^7.14.5", "@babel/helper-plugin-utils@^7.27.1", "@babel/helper-plugin-utils@^7.8.0":
  version "7.27.1"
  resolved "https://registry.yarnpkg.com/@babel/helper-plugin-utils/-/helper-plugin-utils-7.27.1.tgz#ddb2f876534ff8013e6c2b299bf4d39b3c51d44c"
  integrity sha512-1gn1Up5YXka3YYAHGKpbideQ5Yjf1tDa9qYcgysz+cNCXukyLl6DjPXhD3VRwSb8c0J9tA4b2+rHEZtc6R0tlw==
```

## 5. Same Package, Different Versions (No Deduplication Possible)

```yaml
lodash@^3.10.1:
  version "3.10.1"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-3.10.1.tgz#5bf45e8e49ba4189e17d482789dfd15bd140b7b6"
  integrity sha512-9mDDwqVIma6OZX79ZlDACZl8sBm0TEnkf99zV3iMA4GzkIT/9hiqP5mY0HoT1iNLCrKc/R1HByV+yJfRWVJryQ==

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#679591c564c3bffaae8454cf0b3df370c3d6911c"
  integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==
```

## 6. Package with OR Dependency

```yaml
loose-envify@^1.1.0:
  version "1.4.0"
  resolved "https://registry.yarnpkg.com/loose-envify/-/loose-envify-1.4.0.tgz#71ee51fa7be4caec1a63839f7e682d8132d30caf"
  integrity sha512-lyuxPGr/Wfhrlem2CL/UcnUc1zcqKAImBDzukY7Y5F/yQiNdko6+fRLevlw1HgMySw7f611UIY408EtxRSoK3Q==
  dependencies:
    js-tokens "^3.0.0 || ^4.0.0"
```

## 7. Package with Peer Dependencies (React)

Note: Peer dependencies are NOT stored in yarn.lock. Only regular dependencies appear.

```yaml
react@^18.2.0:
  version "18.3.1"
  resolved "https://registry.yarnpkg.com/react/-/react-18.3.1.tgz#49ab892009c53933625bd16b2533fc754cab2891"
  integrity sha512-wS+hAgJShR0KhEvPJArfuPVN1+Hz1t0Y6n5jLrGQbkb4urgPE/0Rve+1kMB1v/oWgHgm4WIcV+i7F2pTVj+2iQ==
  dependencies:
    loose-envify "^1.1.0"
```

The `peerDependencies` from React's package.json are not recorded.

## 8. Complex Package with Many Merged Ranges

```yaml
"@babel/parser@^7.1.0", "@babel/parser@^7.14.7", "@babel/parser@^7.20.7", "@babel/parser@^7.23.9", "@babel/parser@^7.27.2", "@babel/parser@^7.28.3", "@babel/parser@^7.28.4":
  version "7.28.4"
  resolved "https://registry.yarnpkg.com/@babel/parser/-/parser-7.28.4.tgz#da25d4643532890932cc03f7705fe19637e03fa8"
  integrity sha512-yZbBqeM6TkpP9du/I2pUZnJsRMGGvOuIrhjzC1AwHwW+6he4mni6Bp/m8ijn0iOuZuPI2BfkCoSRunpyjnrQKg==
  dependencies:
    "@babel/types" "^7.28.4"
```

Seven different version ranges all satisfied by 7.28.4!

## 9. Package at Exact Version (No Caret/Tilde)

```yaml
"@types/node@*":
  version "24.7.0"
  resolved "https://registry.yarnpkg.com/@types/node/-/node-24.7.0.tgz#a34c9f0d3401db396782e440317dd5d8373c286f"
  integrity sha512-IbKooQVqUBrlzWTi79E8Fw78l8k1RNtlDDNWsFZs7XonuQSJ8oNYfEeclhprUldXISRMLzBpILuKgPlIxm+/Yw==
  dependencies:
    undici-types "~7.14.0"
```

The wildcard `*` range is used by TypeScript type dependencies.

## 10. Dependency Tree Example

Here's how a dependency chain appears (flattened):

```yaml
# axios depends on form-data
axios@^1.4.0:
  version "1.12.2"
  dependencies:
    follow-redirects "^1.15.6"
    form-data "^4.0.4"
    proxy-from-env "^1.1.0"

# form-data has its own dependencies
form-data@^4.0.4:
  version "4.0.4"
  dependencies:
    asynckit "^0.4.0"
    combined-stream "^1.0.8"
    es-set-tostringtag "^2.1.0"
    hasown "^2.0.2"
    mime-types "^2.1.12"

# combined-stream also has dependencies
combined-stream@^1.0.8:
  version "1.0.8"
  dependencies:
    delayed-stream "~1.0.0"

# And so on... all flattened
delayed-stream@~1.0.0:
  version "1.0.0"
  resolved "https://registry.yarnpkg.com/delayed-stream/-/delayed-stream-1.0.0.tgz"
  integrity sha512-ZySD7Nf91aLB0RxL4KGrKHBXl7Eds1DAmEdcoVawXnLD7SDhpNgtuII2aAkg7a7QS41jxPSZ17p4VdGnMHk3MQ==
```

## 11. Workspace Package Dependencies

**IMPORTANT**: Workspace packages do NOT appear in yarn.lock.

Our monorepo structure:
```
packages/
  app/package.json       - depends on lib-a@^1.0.0, lib-b@^1.0.0
  lib-a/package.json     - depends on axios@^1.4.0
  lib-b/package.json     - depends on express@^4.18.2
```

In yarn.lock:
- ✅ axios@^1.4.0 is present
- ✅ express@^4.18.2 is present  
- ❌ lib-a is NOT present
- ❌ lib-b is NOT present

Instead, Yarn creates symlinks:
```bash
$ ls -la node_modules/
lrwxr-xr-x  lib-a -> ../packages/lib-a
lrwxr-xr-x  lib-b -> ../packages/lib-b
```

## 12. Dev vs Prod Dependencies

**IMPORTANT**: There is NO distinction in yarn.lock between dev and prod dependencies.

From root package.json:
```json
{
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

In yarn.lock, it appears identically to regular dependencies:
```yaml
typescript@^5.0.0:
  version "5.7.3"
  resolved "https://registry.yarnpkg.com/typescript/-/typescript-5.7.3.tgz"
  integrity sha512-84MVSjMEHP+FTCqJOD0Lj+gY3IfZ+GnCiSRe3GgG0ud2kR1dKsum8SXPZ7L6SCVgW8qHhfkl5jQQwgPQuD0Oy/Q==
```

The fact that it's a dev dependency is only known from package.json.

## 13. Resolution URL Format

All `resolved` URLs follow this pattern:

```
https://registry.yarnpkg.com/{package-name}/-/{package-name}-{version}.tgz#{shasum}
```

For scoped packages:
```
https://registry.yarnpkg.com/@{scope}/{name}/-/{name}-{version}.tgz#{shasum}
```

Examples:
- `https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#679591c564c3bffaae8454cf0b3df370c3d6911c`
- `https://registry.yarnpkg.com/@babel/core/-/core-7.28.4.tgz#12a550b8794452df4c8b084f95003bce1742d496`

## 14. Integrity Hash Format

All integrity hashes are SHA-512, base64 encoded:

```
integrity sha512-{base64-encoded-hash}==
```

Example:
```
integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==
```

This is the [Subresource Integrity](https://www.w3.org/TR/SRI/) standard used by browsers.
