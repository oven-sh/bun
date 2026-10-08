// This test to grantee parsers won't allow static import source to
// be parenthesized, that accidentally break #8016

import {} from (('a'));
