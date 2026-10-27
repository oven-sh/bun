// Brotli streams written bit by bit. Each one is a short way to one rule of the format (RFC 7932), or to a bug that a
// decoder once had.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { once } from "node:events";
import zlib from "node:zlib";

/**
 * What it is about, the stream in hex, and what `observe` makes of it. Which of its two codes a meta-block that is too
 * long gets depends on where the input pauses: `inPieces` is what comes of one byte at a time, if that is different.
 */
type Row = [name: string, stream: string, expected: string, inPieces?: string];

/** From java/org/brotli/dec/SynthTest.java of google/brotli, with the names of its tests. */
const synthTest: Row[] = [
  ["BaseDictWord", "1b030000000080e3b40d0000075b2631400200e04e1b4102", "= time"],
  ["BaseDictWordFinishBlockOnRingbufferWrap", "1b1f0000000080e3b40d0000075b2631400200e04e9b5832343434343434343434343434343434343434343434343434343434d400", "= aaaaaaaaaaaaaaaaaaaaaaaaaaaatime"],
  ["BaseDictWordTooLong", "1b000000000080e3b40d0000075b2631400200e04e1b4102", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["BlockCountMessage", "1b0b0011018cc1c50d08002265e1fcfd222cc4000038d832890112000077da041042000000", "= aabbaaaaabab"],
  ["BlockSwitchMessage", "1b0b00d1e101c6e0e206040091b270fe7e11166200001c6c99c4000900803b6d020882000000", "= aabbaaaaabab"],
  ["ClClTreeDeficiency", "1b0300000001804301e005885590010038d832890112000077da284023", "ERR__ERROR_FORMAT_CL_SPACE"],
  ["ClClTreeExcess", "1b030000000180c37b8058410600e060cb2406480000dc69a3008d00", "ERR__ERROR_FORMAT_CL_SPACE"],
  ["ComplexHuffmanCodeTwoSymbols", "1b0100008003e0a21a00000eb64c62800400c09d361204", "= ab"],
  ["CompressedUncompressedShortCompressed", "8bfe0100000080e3b40d0000075b2631400200e04e9b666f1b0a500010626262626262310000000000384edb000070b0651203240000eeb4112400", "= 1032 bytes, e76d96823429afd0"],
  ["CompressedUncompressedShortCompressedSmallWindow", "21f40f000000001ca76d000038d832890112000077da347bdb50800280626262626262310000000000384edb000070b0651203240000eeb4112400", "= 1032 bytes, e76d96823429afd0"],
  ["CopyLengthTooLong", "1b010000000080e3b40d0000075b2631400200e04e1b118602", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["CustomHuffmanCode", "1b030000000180c33d8058820800c0c196490c900000b8d346011a01", "= aaab"],
  ["Empty", "3b", "= "],
  ["HelloWorld", "1b0a0000000080e3b40d0000075b2631400200e04e9b005998dad8d813b8db3bd99800", "= hello world"],
  ["InsertTooLong", "1b000000000080e3b40d0000075b2631400200e04e1b098646", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2", "ERR__ERROR_FORMAT_BLOCK_LENGTH_1"],
  ["InvalidNoLastMetablock", "0b060000000080e3b40d0000075b2631400200e04e9b00135998dad8d813b8db3bd998e800", "Z_BUF_ERROR"],
  ["InvalidNoMetaBlocks", "0b", "Z_BUF_ERROR"],
  ["InvalidTooFarDist", "a14800000000001ca76d000038d832890112000077dae8e0626f4f6066e844380f090d", "ERR__ERROR_FORMAT_DICTIONARY"],
  ["InvalidTooLargeContextMap", "1b0000d1e101c6e0e206000091b270fefb455888010070b0651203240000eeb41101", "ERR__ERROR_FORMAT_CONTEXT_MAP_REPEAT"],
  ["InvalidTransformType", "1b030000000080e3b40d0000075b2631400200e04e1b412d0119", "ERR__ERROR_FORMAT_TRANSFORM"],
  ["InvalidWindowBits9", "911000000000001ca76d000038d832890112000077dac82032d401", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["ManyTinyMetablocks", "0b" + "008061000000000000384edb000070b0651203240000eeb4116104".repeat(299) + "008061000000000000384edb000070b0651203240000eeb4116134", "= 600 bytes, acb0f435faa777a4"],
  ["NegativeDistance", "1b0f0000000080e3b40d0000075b2631400200e04e1b410201420142014201420142011c", "ERR__ERROR_FORMAT_DISTANCE"],
  ["NegativeRemainingLenBetweenMetablocks", "0b000000000080e3b40d0000075b2631400200e04e1b098646110000000000384edb000070b0651203240000eeb491606804", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2", "ERR__ERROR_FORMAT_BLOCK_LENGTH_1"],
  ["OneCommand", "1b020000000080e3b40d0000075b2631400200e04e1b118602", "= aaa"],
  ["OneInsert", "1b010000000080e3b40d0000075b2631400200e04e1b098646", "= ab"],
  ["SimplePrefix", "1b030000a0c3c4c6c8020070b0651203240000eeb451a01d", "= abcd"],
  ["SimplePrefixDuplicateSymbols", "1b030000a0c3c4c2c4020070b0651203240000eeb451a01d", "ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_SAME"],
  ["SimplePrefixOutOfRangeSymbols", "1b030000000080e3b44dffef7ffffc0700b8d306", "ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET"],
  ["SimplePrefixPlusExtraData", "1b030000a0c3c4c6c8020070b0651203240000eeb451a01d55aa", "= abcd"],
  ["TooManySymbolsRepeated", "1b030000000180c33d8058820c00c0c196490c900000b8d346011a01", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["TransformedDictWord", "1b080000000080e3b40d0000075b2631400200e04e1b41090101", "= time the "],
  ["TransformedDictWordTooLong", "1b030000000080e3b40d0000075b2631400200e04e1b41090101", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["IntactDistanceRingBuffer0", "1b0a0000000080e3b40d0000075b2631400200e04e1ba1802000", "= himselfself"],
  ["IntactDistanceRingBuffer1", "1b090000000080e3b40d0000075b2631400200e04e1b21a02000", "= scrollroll"],
  ["IntactDistanceRingBuffer2", "1b0f0000000080e3b40d0000075b2631400200e04e1b4180205010240806", "= leftdatadataleft"],
  ["IntactDistanceRingBufferNoDistanceValue0", "1b170000000080e3b40d0000075b2631400200e04e1b408240419020581800", "= leftdatadataleftleftleft"],
  ["IntactDistanceRingBufferNoDistanceValue1", "1b190000000080e3b40d0000075b2631400200e04e1bc08241419020581800", "= worldwhitebackdowndowndown"],
  ["AllTransforms10", "1bfc0500000080e3b40d0000075b2631400200e04e1b137c8426f804104cf0893830c1274ec1049f640626f8243f34c1277d82093ee9164df0c9d2c0049f0c8f4cf0c906d1049f6c924df0c939c1049fdc944cf0c969d1049f3c984df0299c81093e453731c1a7604726f814facc049fc2209ae0534854137c8a8f6c824fb1d24df0296782093ee54f31c1a77c4a26f89457cd049f122c9ae053ba55137ccabf6c824fb9d84df0a93003137c2ad2c2049f4a3631c1a7ca6d4cf0a99423137c2aebca049fea3c33c1a7b2ef4cf0a9f843137caa00d3049f2a4235c1a7c2704df0a95264137c2a1adb049f6a4837c1a792f24df0a9c304137cea32c3049f7a4e31c1a706744cf0a91925137c6a4dcb049f1a5533c1a756f54cf0a95d45137cea59d3049ffa5735c1a766764df0a99f65137c6a6fdb049f9a5d37c1a706f84df0690c0626f8340807137c1a8b85093e8dc8c3049fe66562824fb37331c1a741da98e0d3547d4cf069c44626f8347227137c1ac595093e8de5cb049f067566824f437b33c1a709de99e0d334ff4cf069b28726f834e947137c9afba5093e4d01d4049f46826a824f038235c1a761e19ae0d3e4804df0698ac826f8345268137c9a2fb6093e8d1bdc049f868f6e824fb38837c1a7d9e49be0d39e024cf0696d0926f8b4c308137c5a6886093ead37c4049f569d62824f9b8f31c1a72de898e0d34a844cf0693f4a26f8b42c29137cda9c96093e2d52cc049fb6aa66824f2b9633c1a77deb99e0d3f6054df069178b26f8b49749137cdad1a6093e2d6cd4049fb6b76a824fab9c35c1a7c5ee9ae0d39a874df069e9cb", "= 1533 bytes, 6451f48f2f6defc0"],
  ["AllTransforms4", "1b400300000080e3b40d0000075b2631400200e04e1b513e42513e8102513e1104a27ce20b44f9241b10e5938450944fba02513e690c45f9643920ca271322513ed9118af2c9a258944f4e05a27c722c12e59383a1289ffc8c45f9146e40944f714744f9148048944f81c844f9148e50944f414945f9149b58944f11ca45f994a340944f994a44f994b348944f59cb44f994b850944f094c45f994cb58944f19cd45f954d880289fca9b10e5539923a27caa7346944f250f89f2a9f029513ed54026caa762e844f9540da1289fcaa114e55361a4a27caa8c56944f45128bf2a9526a513e954c2ecaa7dae945f9d44481289fbaa810e5533725a27c6aaa46944fad1589f2a9c52a513eb55a26caa75eeb44f9d46ca1289fbaad14e553cfa5a27c6abd56944fbd178bf2a9096b513e35632ecaa7d6ec45f9349b01513e0d6741944f439a10e5d3a83644f934b111513ecd6d45944fe39b11e5d3147744f934cc21513e8d7549944f839e12e5d3b8b744f934fa31513e0d804d944f73a013e5d334f844f9341342513e4d8751944f53a214e5d3b43845f9343452513e0d8f55944f23a415e5d3247945f9344f62513e8d9559944fd3a516e5d398b945f9346e72513ecd9d5d944f13a817e5d31cfa45f9b49002513eeda541944feba910e5d39a3a44f9b4ac12513e6dad45944fbbab11e5d30a7b44f9b4c922513e2db449944f7bad12e5d382bb44f9b4e732513eadbb4d944f5baf13e5d3f6fb44f9b40543513eedc251944f1bb114e5d3623c45f9b41f53513eadc955944febb215e5d3da7c45f9b43e63", "= 833 bytes, 8748800eed1a80b0"],
  ["CopyTooLong", "a10800000000001ca76d000038d832890112000077da34abdb5000", "ERR__ERROR_FORMAT_BLOCK_LENGTH_1"],
  ["DistanceLut", "8b020000000080e3b40d0000075b2631400200e04e1b998646c6221400000300001ca76d000038d832890112219169626a36", "= abcabcdefdef"],
  ["StressReadDistanceExtraBits", "4ffeff3f00000080e3b40d0000075b2631400200e04e9bf669efff0c8d8c05100000000000384edb000070b065120324a8aaefabaa7f2416358fac9e3df7f3e30afcff03000078010830313233343536373839414243444546303132333435363738394142434445463031323334353637383941424344454603", "= 8388656 bytes, 2fefb091c5cdd347"],
  ["ZeroCostLiterals", "9bffffff002054000038d832890112000077dacce17bfa0f", "= 16777216 bytes, 22e57c15beae6221"],
  ["ZeroCostCommand", "a1f81f0000a112820400", "= 1024 bytes, ad441fdf9c4c00fd"],
  ["PeculiarWrap", "21fc1f0000a1128204601d00cafebabedeadbeef210000000000384edb000070b0651203240000eeb4916168640c", "= 2051 bytes, acf05b17e118d351"],
];

const handmade: Row[] = [
  ["an empty last meta-block", "06", "= "],
  ["the window size that is not one", "9101", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["a large window of 30 bits", "11de", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["a large window of 9 bits", "11c9", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["a large window of 31 bits", "11df", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["MLEN in 5 nibbles, the last of them 0", "0a000000", "ERR__ERROR_FORMAT_EXUBERANT_NIBBLE"],
  ["MLEN in 6 nibbles, the last of them 0", "12000000", "ERR__ERROR_FORMAT_EXUBERANT_NIBBLE"],
  ["ends after an MLEN of 16 MiB", "f2ffff1f", "Z_BUF_ERROR"],
  ["an uncompressed meta-block", "40001068656c6c6f03", "= hello"],
  ["an uncompressed meta-block after padding that is not 0", "4000f068656c6c6f03", "ERR__ERROR_FORMAT_PADDING_1"],
  ["ends inside an uncompressed meta-block", "40001068656c", "Z_BUF_ERROR"],
  ["ends after an uncompressed meta-block", "40001068656c6c6f", "Z_BUF_ERROR"],
  ["metadata", "2c02ffffffffff03", "= "],
  ["what would be metadata, after ISLAST and ISLASTEMPTY", "5a04ffffffffff", "= "],
  ["what would be empty metadata, after ISLAST and ISLASTEMPTY", "1a", "= "],
  ["metadata with the reserved bit set", "3c02ffffffffff03", "ERR__ERROR_FORMAT_RESERVED"],
  ["the length of metadata in 2 bytes, the last of them 0", "4c0200ffffffffff03", "ERR__ERROR_FORMAT_EXUBERANT_META_NIBBLE"],
  ["metadata after padding that is not 0", "2c82ffffffffff03", "ERR__ERROR_FORMAT_PADDING_1"],
  ["ends inside metadata", "2c02ffffff", "Z_BUF_ERROR"],
  ["a literal and a copy of it", "620000004458241210", "= aaaa"],
  ["a copy past MLEN", "420000004458241210", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["literals past MLEN", "220000004458a01210", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["a word of 3 bytes, which the dictionary does not have", "620000004458241211", "ERR__ERROR_FORMAT_DICTIONARY"],
  ["a word from the dictionary", "820000004458281211", "= adown"],
  ["a word from the dictionary past MLEN", "420000004458281211", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["the implicit last distance, before any copy", "820000004458281010", "= alife"],
  ["distance code 0, before any copy", "820000004458281200", "= alife"],
  ["distance code 1, before any copy", "820000004458281201", "= asite"],
  ["distance code 2, before any copy", "820000004458281202", "= alike"],
  ["distance code 3, before any copy", "820000004458281203", "= afree"],
  ["distance code 4, before any copy", "820000004458281204", "= adown"],
  ["distance code 5, before any copy", "820000004458281205", "= aleft"],
  ["distance code 6, before any copy", "820000004458281206", "= atime"],
  ["distance code 7, before any copy", "820000004458281207", "= aback"],
  ["distance code 8, before any copy", "820000004458281208", "= aaaaa"],
  ["distance code 9, before any copy", "820000004458281209", "= acode"],
  ["distance code 10, before any copy", "82000000445828120a", "= aonly"],
  ["distance code 11, before any copy", "82000000445828120b", "= acity"],
  ["distance code 12, before any copy", "82000000445828120c", "= ashow"],
  ["distance code 13, before any copy", "82000000445828120d", "= aopen"],
  ["distance code 14, before any copy", "82000000445828120e", "= adata"],
  ["distance code 15, before any copy", "82000000445828120f", "= ajust"],
  ["the last distance - 1, which is 0", "e2000000445824520414", "ERR__ERROR_FORMAT_DISTANCE"],
  ["the last distance - 2, which is -1", "e2000000445824520614", "ERR__ERROR_FORMAT_DISTANCE"],
  ["the last distance - 3, which is -2", "e2000000445824520814", "ERR__ERROR_FORMAT_DISTANCE"],
  ["the distance before the last - 1, which is 3", "e2000000445824520a14", "= aaaaaaaa"],
  ["the distance before the last - 2, which is 2", "e2000000445824520c14", "= aaaaaaaa"],
  ["the distance before the last - 3, which is 1", "e2000000445824520e14", "= aaaaaaaa"],
  ["the longest distance, which is no transform of a word", "8200000044582812ffffff3f", "ERR__ERROR_FORMAT_TRANSFORM"],
  ["a simple code with the same symbol twice", "62000000545858241210", "ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_SAME"],
  ["a simple code of 4 symbols with the same symbol twice", "620000007480c04080482420", "ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_SAME"],
  ["a simple code with symbol 704 of 704", "620000004458001b10", "ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET"],
  ["a simple code with symbol 1023 of 704", "620000004458fc1f10", "ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET"],
  ["a simple code of 4 symbols", "620000007498d818994a4492822200", "= aaaa"],
  ["code lengths that are all 0", "620000000020000000914840", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["code lengths that are all 1, which two symbols use up", "62000000200000000091484001", "= hex 01010101"],
  ["code lengths that are all 8, from a code length code with one length of 5", "620000000000000f004422011902", "= aaaa"],
  ["code lengths that are all 15", "620000000000000080914840", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["only repeats of the initial code length 8, one too many", "620000000000200000aa91484086", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["only runs of zeros", "620000000000020000ff23918000", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["a code length code that is complete after 2 lengths", "620000007047241250", "= hex 01010101"],
  ["a code length code with too many short codes", "62000000b0bb482420", "ERR__ERROR_FORMAT_CL_SPACE"],
  ["a code length code that is incomplete", "62000000b00100000044220101", "ERR__ERROR_FORMAT_CL_SPACE"],
  ["a code length code without lengths", "620000000000000000914840", "ERR__ERROR_FORMAT_CL_SPACE"],
  ["a code length code without lengths, after skipping 3", "620000000c00000044220101", "ERR__ERROR_FORMAT_CL_SPACE"],
  ["two code lengths of 1", "620000007000c011890414", "= hex 01010101"],
  ["one code length of 1", "6200000070009cff8c440202", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["a run of zeros past the end of the alphabet", "620000007000dcff7f241210", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["a repeated code length past the end of the alphabet", "620000007000c0fdff1f890404", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["a switch by block type code 0", "c2002082000040acf201ffffffffffffffff445888052a010100", "= ababaaa"],
  ["a switch by block type code 1", "c20020a2000040acf201ffffffffffffffff445888052a010100", "= ababaaa"],
  ["a switch by block type code 2", "c20020c2000040acf201ffffffffffffffff445888052a010100", "= aaaaaaa"],
  ["a switch by block type code 3", "c20020e2000040acf201ffffffffffffffff445888052a010100", "= abbbbbb"],
  ["a run of zeros up to the end of the context map", "c20020a2000040ac300014612116a8040400", "= aaaaaaa"],
  ["a run of zeros 1 past the end of the context map", "c20020a2000040ac301014612116a8040400", "ERR__ERROR_FORMAT_CONTEXT_MAP_REPEAT"],
  ["a run of zeros far past the end of the context map", "c20020a2000040acf0ff17612116a8040400", "ERR__ERROR_FORMAT_CONTEXT_MAP_REPEAT"],
  ["a context map that starts with a run past its end", "c20020a2000040acf00f14612116a8040400", "ERR__ERROR_FORMAT_CONTEXT_MAP_REPEAT"],
  ["literals whose context is the end of an uncompressed meta-block", "20001078795111000080500200080000000000106e9115900404", "= xyQYn"],
  ["literals whose context is an uncompressed meta-block of 1 byte", "0000105111000080500200080000000000106e9115900404", "= QYn"],
  ["literals whose context comes before metadata", "20001078795156007a7a11000080500200080000000000106e9115900404", "= xyQYn"],
  ["literals whose context is the start of the stream", "22000000a1040010000000000020dc222b200908", "= nn"],
  ["code lengths that are all 8, from a code length code with one length of 1", "62000000000000070004280104080c1000", "= hex 8040c020"],
  ["code lengths that are all 8, with 4 different literals", "620000000000000f0004280104080c1000", "= hex 8040c020"],
  ["MLEN in 5 nibbles, the last of them 0, with another window size", "aa000000", "ERR__ERROR_FORMAT_EXUBERANT_NIBBLE"],
  ["the length of metadata in 2 bytes, the last of them 0, with another window size", "cc0200", "ERR__ERROR_FORMAT_EXUBERANT_META_NIBBLE"],
  ["padding with bit 7 set", "86", "ERR__ERROR_FORMAT_PADDING_2"],
  ["a large window of 3 bits", "1103", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["a word from the dictionary, twice by distance code 0", "e20000004450081200", "= leftleft"],
  ["a word from the dictionary, twice by the implicit distance code 0", "e20000004450081000", "= leftleft"],
  ["words from the dictionary leave the last distances as they are (1)", "62020000445008d240200cb001", "= leftdatadataleftleft"],
  ["words from the dictionary leave the last distances as they are (2)", "620200004450092048038130d03d", "= leftdatadataleftleft"],
  ["words from the dictionary leave the last distances as they are (3)", "62020000445008d240200cc406", "= citycitylifelifecity"],
  ["words from the dictionary leave the last distances as they are (4)", "0203000044500cd240200cc006", "= worldorldofirstworldorldo"],
  ["the stream of google/brotli issue 502", "e2e184886a563080e0391603e430f9", "= 10000 bytes, a0412aec45e56e4d"],
  ["more literals than MLEN, 16 MiB", "f2ffff1f004450e017c0ffff3f", "ERR__ERROR_FORMAT_BLOCK_LENGTH_1"],
  ["metadata whose header ends on a byte boundary", "300000005490508010805a000003", "= ABAB"],
  ["bytes after the end", "210c00047465737403fffe", "= test"],
  ["a copy of 16 MiB at distance 1 (CVE-2016-1624, CVE-2016-1968)", "f2ffff1f0044503c1650eefd3f", "= 16777216 bytes, e6c907c2d418fa03"],
  ["a copy of 16 MiB at distance 1 in a window of 1 KiB (CVE-2016-1624, CVE-2016-1968)", "a1fcffff070011148f05947bff0f", "= 16777216 bytes, e6c907c2d418fa03"],
  ["a copy of 3000 bytes that ends 1 past MLEN", "e276010044503c1690dc0000", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["101 literals in an MLEN of 100", "620c00004450e014d000", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["a word of 4 bytes in an MLEN of 3", "420000004450281250", "ERR__ERROR_FORMAT_BLOCK_LENGTH_2"],
  ["padding that is not 0 after a last meta-block with data", "620000004450801290", "ERR__ERROR_FORMAT_PADDING_2"],
  ["padding with bit 3 set", "0e", "ERR__ERROR_FORMAT_PADDING_2"],
  ["padding with bit 4 set", "16", "ERR__ERROR_FORMAT_PADDING_2"],
  ["padding with bit 5 set", "26", "ERR__ERROR_FORMAT_PADDING_2"],
  ["padding with bit 6 set", "46", "ERR__ERROR_FORMAT_PADDING_2"],
  ["code lengths that are all 8, from a code length code with one length of 3", "6200000000000002000142008646c626", "= abcd"],
  ["code lengths that are all 7, which half of the literals use up", "620000000000800000014200c3d17802", "= abcd"],
  ["code lengths that are all 9, which is not enough for 256 literals", "6200000000000008000142000000000000", "ERR__ERROR_FORMAT_HUFFMAN_SPACE"],
  ["the window size that is not one, with bit 7 set", "91de", "ERR__ERROR_FORMAT_WINDOW_BITS"],
];

/** For a decoder with `BROTLI_DECODER_PARAM_LARGE_WINDOW`. */
const largeWindow: Row[] = [
  ["more literals than the 16 MiB that a block type without switches lasts", "111900000241f9ffff0f00022ff00b80ffff7f", "ERR__ERROR_FORMAT_BLOCK_SWITCH"],
  ["a large window of 30 bits", "11de", "= "],
  ["a large window of 9 bits", "11c9", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["a large window of 31 bits", "11df", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["a large window of 3 bits", "1103", "ERR__ERROR_FORMAT_WINDOW_BITS"],
  ["a large window of 10 bits", "11ca", "= "],
  ["the window size that is not one, with bit 7 set", "91de", "ERR__ERROR_FORMAT_WINDOW_BITS"],
];

/** `= ` and the output (as text, in hex, or its length and the start of its SHA-256), or the code of the error. */
async function observe(decode: () => Buffer | Promise<Buffer>) {
  try {
    const out = await decode();
    if (out.length <= 32 && out.every(byte => byte >= 32 && byte < 127)) return `= ${out.toString("latin1")}`;
    if (out.length <= 8) return `= hex ${out.toString("hex")}`;
    return `= ${out.length} bytes, ${createHash("sha256").update(out).digest("hex").slice(0, 16)}`;
  } catch (e: any) {
    return `${e.code}`;
  }
}

async function decodeInPieces(input: Buffer, size: number, options: zlib.BrotliOptions) {
  const stream = zlib.createBrotliDecompress(options);
  const chunks: Buffer[] = [];
  stream.on("data", chunk => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => stream.on("end", resolve).on("error", reject));
  for (let at = 0; at < input.length; at += size) stream.write(input.subarray(at, at + size));
  stream.end();
  await done;
  return Buffer.concat(chunks);
}

describe.each([
  ["SynthTest", synthTest, {}],
  ["handmade", handmade, {}],
  ["large window", largeWindow, { params: { [zlib.constants.BROTLI_DECODER_PARAM_LARGE_WINDOW]: 1 } }],
] as [string, Row[], zlib.BrotliOptions][])("%s", (_, rows, options) => {
  test.concurrent.each(rows)("%s", async (_, hex, expected, inPieces = expected) => {
    const stream = Buffer.from(hex, "hex");
    expect(await observe(() => zlib.brotliDecompressSync(stream, options))).toBe(expected);
    expect(await observe(() => decodeInPieces(stream, Math.ceil(stream.length / 600), options))).toBe(inPieces);
    // What is decided does not depend on what follows. Not for the longer ones: a debug build takes 2 ms for each length.
    if (stream.length > 20 || / bytes, /.test(expected)) return;
    let decided = false;
    for (let length = 0; length < stream.length; length++) {
      const result = await observe(() => zlib.brotliDecompressSync(stream.subarray(0, length), options));
      decided ||= result !== "Z_BUF_ERROR";
      expect(result).toBe(decided ? expected : "Z_BUF_ERROR");
    }
  });
});

// The window is 1 KiB. An empty block of metadata brings the stream to a byte boundary.
test.each([
  [[1008]],
  [[1008, 16, 1]],
  [[1023]],
  [[1023, 1]],
  [[1024]],
  [[1024, 1024]],
  [[1025]],
  [[1, 1023]],
  [[1, 1024, 1]],
  [[2048]],
  [[3079]],
  [[512, 512, 512, 512, 1]],
])("uncompressed meta-blocks of %j bytes, around the end of the ring buffer", async lengths => {
  const data = createHash("shake256", { outputLength: lengths.reduce((a, b) => a + b) }).digest();
  const parts = [Buffer.from("2103", "hex")];
  let at = 0;
  for (const length of lengths) {
    const header = Buffer.alloc(3);
    header.writeUIntLE(((length - 1) << 3) | (1 << 19), 0, 3);
    parts.push(header, data.subarray(at, (at += length)));
  }
  const stream = Buffer.concat([...parts, Buffer.from([3])]);
  expect(zlib.brotliDecompressSync(stream).equals(data)).toBe(true);
  expect((await decodeInPieces(stream, 100, {})).equals(data)).toBe(true);
});

test("a byte is delivered before the input that follows it arrives", async () => {
  const stream = zlib.createBrotliDecompress();
  stream.write(Buffer.from("0000102a", "hex"));
  const [chunk] = await once(stream, "data");
  expect(chunk.toString()).toBe("*");
  stream.destroy();
});

test("a distance past the start of the stream is into the attached dictionary, or else into the built-in one", () => {
  const stream = Buffer.from("a1a800c02f0110c4440900", "hex");
  const dictionary = Buffer.from("Kot lomom kolol slona!");
  expect(zlib.brotliDecompressSync(stream, { dictionary }).toString()).toBe("Kot lomom kolol slona!");
  expect(zlib.brotliDecompressSync(stream).toString()).toBe('alternate" type="appli');
});

test("maxOutputLength stops 14 bytes that decode to 16 MiB", () => {
  const stream = Buffer.from("9fffffff00208202bf007c4fff01", "hex");
  expect(() => zlib.brotliDecompressSync(stream, { maxOutputLength: 1 << 20 })).toThrow(
    expect.objectContaining({ code: "ERR_BUFFER_TOO_LARGE" }),
  );
});
