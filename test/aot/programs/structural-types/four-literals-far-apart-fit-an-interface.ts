// 1,152 object literals in 96 rows of 12, each with a name of its own, an interface for each row, which its 12 literals fit, and one for each column, which four literals fit, 24 rows apart. The shapes are numbered along the rows, so the four lie far apart: a handful of shapes over a span of some 900, which is a table with a slot for each and no set of bits. A field and a parameter of each of the 12 column types take every literal, through a store by a computed name, through a call from untyped code and through a test in typed code.
interface Row0 {
  row0: number;
}
interface Row1 {
  row1: number;
}
interface Row2 {
  row2: number;
}
interface Row3 {
  row3: number;
}
interface Row4 {
  row4: number;
}
interface Row5 {
  row5: number;
}
interface Row6 {
  row6: number;
}
interface Row7 {
  row7: number;
}
interface Row8 {
  row8: number;
}
interface Row9 {
  row9: number;
}
interface Row10 {
  row10: number;
}
interface Row11 {
  row11: number;
}
interface Row12 {
  row12: number;
}
interface Row13 {
  row13: number;
}
interface Row14 {
  row14: number;
}
interface Row15 {
  row15: number;
}
interface Row16 {
  row16: number;
}
interface Row17 {
  row17: number;
}
interface Row18 {
  row18: number;
}
interface Row19 {
  row19: number;
}
interface Row20 {
  row20: number;
}
interface Row21 {
  row21: number;
}
interface Row22 {
  row22: number;
}
interface Row23 {
  row23: number;
}
interface Row24 {
  row24: number;
}
interface Row25 {
  row25: number;
}
interface Row26 {
  row26: number;
}
interface Row27 {
  row27: number;
}
interface Row28 {
  row28: number;
}
interface Row29 {
  row29: number;
}
interface Row30 {
  row30: number;
}
interface Row31 {
  row31: number;
}
interface Row32 {
  row32: number;
}
interface Row33 {
  row33: number;
}
interface Row34 {
  row34: number;
}
interface Row35 {
  row35: number;
}
interface Row36 {
  row36: number;
}
interface Row37 {
  row37: number;
}
interface Row38 {
  row38: number;
}
interface Row39 {
  row39: number;
}
interface Row40 {
  row40: number;
}
interface Row41 {
  row41: number;
}
interface Row42 {
  row42: number;
}
interface Row43 {
  row43: number;
}
interface Row44 {
  row44: number;
}
interface Row45 {
  row45: number;
}
interface Row46 {
  row46: number;
}
interface Row47 {
  row47: number;
}
interface Row48 {
  row48: number;
}
interface Row49 {
  row49: number;
}
interface Row50 {
  row50: number;
}
interface Row51 {
  row51: number;
}
interface Row52 {
  row52: number;
}
interface Row53 {
  row53: number;
}
interface Row54 {
  row54: number;
}
interface Row55 {
  row55: number;
}
interface Row56 {
  row56: number;
}
interface Row57 {
  row57: number;
}
interface Row58 {
  row58: number;
}
interface Row59 {
  row59: number;
}
interface Row60 {
  row60: number;
}
interface Row61 {
  row61: number;
}
interface Row62 {
  row62: number;
}
interface Row63 {
  row63: number;
}
interface Row64 {
  row64: number;
}
interface Row65 {
  row65: number;
}
interface Row66 {
  row66: number;
}
interface Row67 {
  row67: number;
}
interface Row68 {
  row68: number;
}
interface Row69 {
  row69: number;
}
interface Row70 {
  row70: number;
}
interface Row71 {
  row71: number;
}
interface Row72 {
  row72: number;
}
interface Row73 {
  row73: number;
}
interface Row74 {
  row74: number;
}
interface Row75 {
  row75: number;
}
interface Row76 {
  row76: number;
}
interface Row77 {
  row77: number;
}
interface Row78 {
  row78: number;
}
interface Row79 {
  row79: number;
}
interface Row80 {
  row80: number;
}
interface Row81 {
  row81: number;
}
interface Row82 {
  row82: number;
}
interface Row83 {
  row83: number;
}
interface Row84 {
  row84: number;
}
interface Row85 {
  row85: number;
}
interface Row86 {
  row86: number;
}
interface Row87 {
  row87: number;
}
interface Row88 {
  row88: number;
}
interface Row89 {
  row89: number;
}
interface Row90 {
  row90: number;
}
interface Row91 {
  row91: number;
}
interface Row92 {
  row92: number;
}
interface Row93 {
  row93: number;
}
interface Row94 {
  row94: number;
}
interface Row95 {
  row95: number;
}
interface Column0 {
  column0: number;
}
interface Column1 {
  column1: number;
}
interface Column2 {
  column2: number;
}
interface Column3 {
  column3: number;
}
interface Column4 {
  column4: number;
}
interface Column5 {
  column5: number;
}
interface Column6 {
  column6: number;
}
interface Column7 {
  column7: number;
}
interface Column8 {
  column8: number;
}
interface Column9 {
  column9: number;
}
interface Column10 {
  column10: number;
}
interface Column11 {
  column11: number;
}
class Holder {
  column0: Column0 = { column0: -1 };
  column1: Column1 = { column1: -1 };
  column2: Column2 = { column2: -1 };
  column3: Column3 = { column3: -1 };
  column4: Column4 = { column4: -1 };
  column5: Column5 = { column5: -1 };
  column6: Column6 = { column6: -1 };
  column7: Column7 = { column7: -1 };
  column8: Column8 = { column8: -1 };
  column9: Column9 = { column9: -1 };
  column10: Column10 = { column10: -1 };
  column11: Column11 = { column11: -1 };
}
function makeAll(): unknown[] {
  const all: unknown[] = [];
  all.push({ row0: 1, column0: 2, own1: 3 });
  all.push({ row0: 2, own2: 4 });
  all.push({ row0: 3, own3: 5 });
  all.push({ row0: 4, own4: 6 });
  all.push({ row0: 5, own5: 7 });
  all.push({ row0: 6, own6: 8 });
  all.push({ row0: 7, own7: 9 });
  all.push({ row0: 8, own8: 10 });
  all.push({ row0: 9, own9: 11 });
  all.push({ row0: 10, own10: 12 });
  all.push({ row0: 11, own11: 13 });
  all.push({ row0: 12, own12: 14 });
  all.push({ row1: 13, own13: 15 });
  all.push({ row1: 14, column1: 15, own14: 16 });
  all.push({ row1: 15, own15: 17 });
  all.push({ row1: 16, own16: 18 });
  all.push({ row1: 17, own17: 19 });
  all.push({ row1: 18, own18: 20 });
  all.push({ row1: 19, own19: 21 });
  all.push({ row1: 20, own20: 22 });
  all.push({ row1: 21, own21: 23 });
  all.push({ row1: 22, own22: 24 });
  all.push({ row1: 23, own23: 25 });
  all.push({ row1: 24, own24: 26 });
  all.push({ row2: 25, own25: 27 });
  all.push({ row2: 26, own26: 28 });
  all.push({ row2: 27, column2: 28, own27: 29 });
  all.push({ row2: 28, own28: 30 });
  all.push({ row2: 29, own29: 31 });
  all.push({ row2: 30, own30: 32 });
  all.push({ row2: 31, own31: 33 });
  all.push({ row2: 32, own32: 34 });
  all.push({ row2: 33, own33: 35 });
  all.push({ row2: 34, own34: 36 });
  all.push({ row2: 35, own35: 37 });
  all.push({ row2: 36, own36: 38 });
  all.push({ row3: 37, own37: 39 });
  all.push({ row3: 38, own38: 40 });
  all.push({ row3: 39, own39: 41 });
  all.push({ row3: 40, column3: 41, own40: 42 });
  all.push({ row3: 41, own41: 43 });
  all.push({ row3: 42, own42: 44 });
  all.push({ row3: 43, own43: 45 });
  all.push({ row3: 44, own44: 46 });
  all.push({ row3: 45, own45: 47 });
  all.push({ row3: 46, own46: 48 });
  all.push({ row3: 47, own47: 49 });
  all.push({ row3: 48, own48: 50 });
  all.push({ row4: 49, own49: 51 });
  all.push({ row4: 50, own50: 52 });
  all.push({ row4: 51, own51: 53 });
  all.push({ row4: 52, own52: 54 });
  all.push({ row4: 53, column4: 54, own53: 55 });
  all.push({ row4: 54, own54: 56 });
  all.push({ row4: 55, own55: 57 });
  all.push({ row4: 56, own56: 58 });
  all.push({ row4: 57, own57: 59 });
  all.push({ row4: 58, own58: 60 });
  all.push({ row4: 59, own59: 61 });
  all.push({ row4: 60, own60: 62 });
  all.push({ row5: 61, own61: 63 });
  all.push({ row5: 62, own62: 64 });
  all.push({ row5: 63, own63: 65 });
  all.push({ row5: 64, own64: 66 });
  all.push({ row5: 65, own65: 67 });
  all.push({ row5: 66, column5: 67, own66: 68 });
  all.push({ row5: 67, own67: 69 });
  all.push({ row5: 68, own68: 70 });
  all.push({ row5: 69, own69: 71 });
  all.push({ row5: 70, own70: 72 });
  all.push({ row5: 71, own71: 73 });
  all.push({ row5: 72, own72: 74 });
  all.push({ row6: 73, own73: 75 });
  all.push({ row6: 74, own74: 76 });
  all.push({ row6: 75, own75: 77 });
  all.push({ row6: 76, own76: 78 });
  all.push({ row6: 77, own77: 79 });
  all.push({ row6: 78, own78: 80 });
  all.push({ row6: 79, column6: 80, own79: 81 });
  all.push({ row6: 80, own80: 82 });
  all.push({ row6: 81, own81: 83 });
  all.push({ row6: 82, own82: 84 });
  all.push({ row6: 83, own83: 85 });
  all.push({ row6: 84, own84: 86 });
  all.push({ row7: 85, own85: 87 });
  all.push({ row7: 86, own86: 88 });
  all.push({ row7: 87, own87: 89 });
  all.push({ row7: 88, own88: 90 });
  all.push({ row7: 89, own89: 91 });
  all.push({ row7: 90, own90: 92 });
  all.push({ row7: 91, own91: 93 });
  all.push({ row7: 92, column7: 93, own92: 94 });
  all.push({ row7: 93, own93: 95 });
  all.push({ row7: 94, own94: 96 });
  all.push({ row7: 95, own95: 97 });
  all.push({ row7: 96, own96: 98 });
  all.push({ row8: 97, own97: 99 });
  all.push({ row8: 98, own98: 100 });
  all.push({ row8: 99, own99: 101 });
  all.push({ row8: 100, own100: 102 });
  all.push({ row8: 101, own101: 103 });
  all.push({ row8: 102, own102: 104 });
  all.push({ row8: 103, own103: 105 });
  all.push({ row8: 104, own104: 106 });
  all.push({ row8: 105, column8: 106, own105: 107 });
  all.push({ row8: 106, own106: 108 });
  all.push({ row8: 107, own107: 109 });
  all.push({ row8: 108, own108: 110 });
  all.push({ row9: 109, own109: 111 });
  all.push({ row9: 110, own110: 112 });
  all.push({ row9: 111, own111: 113 });
  all.push({ row9: 112, own112: 114 });
  all.push({ row9: 113, own113: 115 });
  all.push({ row9: 114, own114: 116 });
  all.push({ row9: 115, own115: 117 });
  all.push({ row9: 116, own116: 118 });
  all.push({ row9: 117, own117: 119 });
  all.push({ row9: 118, column9: 119, own118: 120 });
  all.push({ row9: 119, own119: 121 });
  all.push({ row9: 120, own120: 122 });
  all.push({ row10: 121, own121: 123 });
  all.push({ row10: 122, own122: 124 });
  all.push({ row10: 123, own123: 125 });
  all.push({ row10: 124, own124: 126 });
  all.push({ row10: 125, own125: 127 });
  all.push({ row10: 126, own126: 128 });
  all.push({ row10: 127, own127: 129 });
  all.push({ row10: 128, own128: 130 });
  all.push({ row10: 129, own129: 131 });
  all.push({ row10: 130, own130: 132 });
  all.push({ row10: 131, column10: 132, own131: 133 });
  all.push({ row10: 132, own132: 134 });
  all.push({ row11: 133, own133: 135 });
  all.push({ row11: 134, own134: 136 });
  all.push({ row11: 135, own135: 137 });
  all.push({ row11: 136, own136: 138 });
  all.push({ row11: 137, own137: 139 });
  all.push({ row11: 138, own138: 140 });
  all.push({ row11: 139, own139: 141 });
  all.push({ row11: 140, own140: 142 });
  all.push({ row11: 141, own141: 143 });
  all.push({ row11: 142, own142: 144 });
  all.push({ row11: 143, own143: 145 });
  all.push({ row11: 144, column11: 145, own144: 146 });
  all.push({ row12: 145, own145: 147 });
  all.push({ row12: 146, own146: 148 });
  all.push({ row12: 147, own147: 149 });
  all.push({ row12: 148, own148: 150 });
  all.push({ row12: 149, own149: 151 });
  all.push({ row12: 150, own150: 152 });
  all.push({ row12: 151, own151: 153 });
  all.push({ row12: 152, own152: 154 });
  all.push({ row12: 153, own153: 155 });
  all.push({ row12: 154, own154: 156 });
  all.push({ row12: 155, own155: 157 });
  all.push({ row12: 156, own156: 158 });
  all.push({ row13: 157, own157: 159 });
  all.push({ row13: 158, own158: 160 });
  all.push({ row13: 159, own159: 161 });
  all.push({ row13: 160, own160: 162 });
  all.push({ row13: 161, own161: 163 });
  all.push({ row13: 162, own162: 164 });
  all.push({ row13: 163, own163: 165 });
  all.push({ row13: 164, own164: 166 });
  all.push({ row13: 165, own165: 167 });
  all.push({ row13: 166, own166: 168 });
  all.push({ row13: 167, own167: 169 });
  all.push({ row13: 168, own168: 170 });
  all.push({ row14: 169, own169: 171 });
  all.push({ row14: 170, own170: 172 });
  all.push({ row14: 171, own171: 173 });
  all.push({ row14: 172, own172: 174 });
  all.push({ row14: 173, own173: 175 });
  all.push({ row14: 174, own174: 176 });
  all.push({ row14: 175, own175: 177 });
  all.push({ row14: 176, own176: 178 });
  all.push({ row14: 177, own177: 179 });
  all.push({ row14: 178, own178: 180 });
  all.push({ row14: 179, own179: 181 });
  all.push({ row14: 180, own180: 182 });
  all.push({ row15: 181, own181: 183 });
  all.push({ row15: 182, own182: 184 });
  all.push({ row15: 183, own183: 185 });
  all.push({ row15: 184, own184: 186 });
  all.push({ row15: 185, own185: 187 });
  all.push({ row15: 186, own186: 188 });
  all.push({ row15: 187, own187: 189 });
  all.push({ row15: 188, own188: 190 });
  all.push({ row15: 189, own189: 191 });
  all.push({ row15: 190, own190: 192 });
  all.push({ row15: 191, own191: 193 });
  all.push({ row15: 192, own192: 194 });
  all.push({ row16: 193, own193: 195 });
  all.push({ row16: 194, own194: 196 });
  all.push({ row16: 195, own195: 197 });
  all.push({ row16: 196, own196: 198 });
  all.push({ row16: 197, own197: 199 });
  all.push({ row16: 198, own198: 200 });
  all.push({ row16: 199, own199: 201 });
  all.push({ row16: 200, own200: 202 });
  all.push({ row16: 201, own201: 203 });
  all.push({ row16: 202, own202: 204 });
  all.push({ row16: 203, own203: 205 });
  all.push({ row16: 204, own204: 206 });
  all.push({ row17: 205, own205: 207 });
  all.push({ row17: 206, own206: 208 });
  all.push({ row17: 207, own207: 209 });
  all.push({ row17: 208, own208: 210 });
  all.push({ row17: 209, own209: 211 });
  all.push({ row17: 210, own210: 212 });
  all.push({ row17: 211, own211: 213 });
  all.push({ row17: 212, own212: 214 });
  all.push({ row17: 213, own213: 215 });
  all.push({ row17: 214, own214: 216 });
  all.push({ row17: 215, own215: 217 });
  all.push({ row17: 216, own216: 218 });
  all.push({ row18: 217, own217: 219 });
  all.push({ row18: 218, own218: 220 });
  all.push({ row18: 219, own219: 221 });
  all.push({ row18: 220, own220: 222 });
  all.push({ row18: 221, own221: 223 });
  all.push({ row18: 222, own222: 224 });
  all.push({ row18: 223, own223: 225 });
  all.push({ row18: 224, own224: 226 });
  all.push({ row18: 225, own225: 227 });
  all.push({ row18: 226, own226: 228 });
  all.push({ row18: 227, own227: 229 });
  all.push({ row18: 228, own228: 230 });
  all.push({ row19: 229, own229: 231 });
  all.push({ row19: 230, own230: 232 });
  all.push({ row19: 231, own231: 233 });
  all.push({ row19: 232, own232: 234 });
  all.push({ row19: 233, own233: 235 });
  all.push({ row19: 234, own234: 236 });
  all.push({ row19: 235, own235: 237 });
  all.push({ row19: 236, own236: 238 });
  all.push({ row19: 237, own237: 239 });
  all.push({ row19: 238, own238: 240 });
  all.push({ row19: 239, own239: 241 });
  all.push({ row19: 240, own240: 242 });
  all.push({ row20: 241, own241: 243 });
  all.push({ row20: 242, own242: 244 });
  all.push({ row20: 243, own243: 245 });
  all.push({ row20: 244, own244: 246 });
  all.push({ row20: 245, own245: 247 });
  all.push({ row20: 246, own246: 248 });
  all.push({ row20: 247, own247: 249 });
  all.push({ row20: 248, own248: 250 });
  all.push({ row20: 249, own249: 251 });
  all.push({ row20: 250, own250: 252 });
  all.push({ row20: 251, own251: 253 });
  all.push({ row20: 252, own252: 254 });
  all.push({ row21: 253, own253: 255 });
  all.push({ row21: 254, own254: 256 });
  all.push({ row21: 255, own255: 257 });
  all.push({ row21: 256, own256: 258 });
  all.push({ row21: 257, own257: 259 });
  all.push({ row21: 258, own258: 260 });
  all.push({ row21: 259, own259: 261 });
  all.push({ row21: 260, own260: 262 });
  all.push({ row21: 261, own261: 263 });
  all.push({ row21: 262, own262: 264 });
  all.push({ row21: 263, own263: 265 });
  all.push({ row21: 264, own264: 266 });
  all.push({ row22: 265, own265: 267 });
  all.push({ row22: 266, own266: 268 });
  all.push({ row22: 267, own267: 269 });
  all.push({ row22: 268, own268: 270 });
  all.push({ row22: 269, own269: 271 });
  all.push({ row22: 270, own270: 272 });
  all.push({ row22: 271, own271: 273 });
  all.push({ row22: 272, own272: 274 });
  all.push({ row22: 273, own273: 275 });
  all.push({ row22: 274, own274: 276 });
  all.push({ row22: 275, own275: 277 });
  all.push({ row22: 276, own276: 278 });
  all.push({ row23: 277, own277: 279 });
  all.push({ row23: 278, own278: 280 });
  all.push({ row23: 279, own279: 281 });
  all.push({ row23: 280, own280: 282 });
  all.push({ row23: 281, own281: 283 });
  all.push({ row23: 282, own282: 284 });
  all.push({ row23: 283, own283: 285 });
  all.push({ row23: 284, own284: 286 });
  all.push({ row23: 285, own285: 287 });
  all.push({ row23: 286, own286: 288 });
  all.push({ row23: 287, own287: 289 });
  all.push({ row23: 288, own288: 290 });
  all.push({ row24: 289, column0: 290, own289: 291 });
  all.push({ row24: 290, own290: 292 });
  all.push({ row24: 291, own291: 293 });
  all.push({ row24: 292, own292: 294 });
  all.push({ row24: 293, own293: 295 });
  all.push({ row24: 294, own294: 296 });
  all.push({ row24: 295, own295: 297 });
  all.push({ row24: 296, own296: 298 });
  all.push({ row24: 297, own297: 299 });
  all.push({ row24: 298, own298: 300 });
  all.push({ row24: 299, own299: 301 });
  all.push({ row24: 300, own300: 302 });
  all.push({ row25: 301, own301: 303 });
  all.push({ row25: 302, column1: 303, own302: 304 });
  all.push({ row25: 303, own303: 305 });
  all.push({ row25: 304, own304: 306 });
  all.push({ row25: 305, own305: 307 });
  all.push({ row25: 306, own306: 308 });
  all.push({ row25: 307, own307: 309 });
  all.push({ row25: 308, own308: 310 });
  all.push({ row25: 309, own309: 311 });
  all.push({ row25: 310, own310: 312 });
  all.push({ row25: 311, own311: 313 });
  all.push({ row25: 312, own312: 314 });
  all.push({ row26: 313, own313: 315 });
  all.push({ row26: 314, own314: 316 });
  all.push({ row26: 315, column2: 316, own315: 317 });
  all.push({ row26: 316, own316: 318 });
  all.push({ row26: 317, own317: 319 });
  all.push({ row26: 318, own318: 320 });
  all.push({ row26: 319, own319: 321 });
  all.push({ row26: 320, own320: 322 });
  all.push({ row26: 321, own321: 323 });
  all.push({ row26: 322, own322: 324 });
  all.push({ row26: 323, own323: 325 });
  all.push({ row26: 324, own324: 326 });
  all.push({ row27: 325, own325: 327 });
  all.push({ row27: 326, own326: 328 });
  all.push({ row27: 327, own327: 329 });
  all.push({ row27: 328, column3: 329, own328: 330 });
  all.push({ row27: 329, own329: 331 });
  all.push({ row27: 330, own330: 332 });
  all.push({ row27: 331, own331: 333 });
  all.push({ row27: 332, own332: 334 });
  all.push({ row27: 333, own333: 335 });
  all.push({ row27: 334, own334: 336 });
  all.push({ row27: 335, own335: 337 });
  all.push({ row27: 336, own336: 338 });
  all.push({ row28: 337, own337: 339 });
  all.push({ row28: 338, own338: 340 });
  all.push({ row28: 339, own339: 341 });
  all.push({ row28: 340, own340: 342 });
  all.push({ row28: 341, column4: 342, own341: 343 });
  all.push({ row28: 342, own342: 344 });
  all.push({ row28: 343, own343: 345 });
  all.push({ row28: 344, own344: 346 });
  all.push({ row28: 345, own345: 347 });
  all.push({ row28: 346, own346: 348 });
  all.push({ row28: 347, own347: 349 });
  all.push({ row28: 348, own348: 350 });
  all.push({ row29: 349, own349: 351 });
  all.push({ row29: 350, own350: 352 });
  all.push({ row29: 351, own351: 353 });
  all.push({ row29: 352, own352: 354 });
  all.push({ row29: 353, own353: 355 });
  all.push({ row29: 354, column5: 355, own354: 356 });
  all.push({ row29: 355, own355: 357 });
  all.push({ row29: 356, own356: 358 });
  all.push({ row29: 357, own357: 359 });
  all.push({ row29: 358, own358: 360 });
  all.push({ row29: 359, own359: 361 });
  all.push({ row29: 360, own360: 362 });
  all.push({ row30: 361, own361: 363 });
  all.push({ row30: 362, own362: 364 });
  all.push({ row30: 363, own363: 365 });
  all.push({ row30: 364, own364: 366 });
  all.push({ row30: 365, own365: 367 });
  all.push({ row30: 366, own366: 368 });
  all.push({ row30: 367, column6: 368, own367: 369 });
  all.push({ row30: 368, own368: 370 });
  all.push({ row30: 369, own369: 371 });
  all.push({ row30: 370, own370: 372 });
  all.push({ row30: 371, own371: 373 });
  all.push({ row30: 372, own372: 374 });
  all.push({ row31: 373, own373: 375 });
  all.push({ row31: 374, own374: 376 });
  all.push({ row31: 375, own375: 377 });
  all.push({ row31: 376, own376: 378 });
  all.push({ row31: 377, own377: 379 });
  all.push({ row31: 378, own378: 380 });
  all.push({ row31: 379, own379: 381 });
  all.push({ row31: 380, column7: 381, own380: 382 });
  all.push({ row31: 381, own381: 383 });
  all.push({ row31: 382, own382: 384 });
  all.push({ row31: 383, own383: 385 });
  all.push({ row31: 384, own384: 386 });
  all.push({ row32: 385, own385: 387 });
  all.push({ row32: 386, own386: 388 });
  all.push({ row32: 387, own387: 389 });
  all.push({ row32: 388, own388: 390 });
  all.push({ row32: 389, own389: 391 });
  all.push({ row32: 390, own390: 392 });
  all.push({ row32: 391, own391: 393 });
  all.push({ row32: 392, own392: 394 });
  all.push({ row32: 393, column8: 394, own393: 395 });
  all.push({ row32: 394, own394: 396 });
  all.push({ row32: 395, own395: 397 });
  all.push({ row32: 396, own396: 398 });
  all.push({ row33: 397, own397: 399 });
  all.push({ row33: 398, own398: 400 });
  all.push({ row33: 399, own399: 401 });
  all.push({ row33: 400, own400: 402 });
  all.push({ row33: 401, own401: 403 });
  all.push({ row33: 402, own402: 404 });
  all.push({ row33: 403, own403: 405 });
  all.push({ row33: 404, own404: 406 });
  all.push({ row33: 405, own405: 407 });
  all.push({ row33: 406, column9: 407, own406: 408 });
  all.push({ row33: 407, own407: 409 });
  all.push({ row33: 408, own408: 410 });
  all.push({ row34: 409, own409: 411 });
  all.push({ row34: 410, own410: 412 });
  all.push({ row34: 411, own411: 413 });
  all.push({ row34: 412, own412: 414 });
  all.push({ row34: 413, own413: 415 });
  all.push({ row34: 414, own414: 416 });
  all.push({ row34: 415, own415: 417 });
  all.push({ row34: 416, own416: 418 });
  all.push({ row34: 417, own417: 419 });
  all.push({ row34: 418, own418: 420 });
  all.push({ row34: 419, column10: 420, own419: 421 });
  all.push({ row34: 420, own420: 422 });
  all.push({ row35: 421, own421: 423 });
  all.push({ row35: 422, own422: 424 });
  all.push({ row35: 423, own423: 425 });
  all.push({ row35: 424, own424: 426 });
  all.push({ row35: 425, own425: 427 });
  all.push({ row35: 426, own426: 428 });
  all.push({ row35: 427, own427: 429 });
  all.push({ row35: 428, own428: 430 });
  all.push({ row35: 429, own429: 431 });
  all.push({ row35: 430, own430: 432 });
  all.push({ row35: 431, own431: 433 });
  all.push({ row35: 432, column11: 433, own432: 434 });
  all.push({ row36: 433, own433: 435 });
  all.push({ row36: 434, own434: 436 });
  all.push({ row36: 435, own435: 437 });
  all.push({ row36: 436, own436: 438 });
  all.push({ row36: 437, own437: 439 });
  all.push({ row36: 438, own438: 440 });
  all.push({ row36: 439, own439: 441 });
  all.push({ row36: 440, own440: 442 });
  all.push({ row36: 441, own441: 443 });
  all.push({ row36: 442, own442: 444 });
  all.push({ row36: 443, own443: 445 });
  all.push({ row36: 444, own444: 446 });
  all.push({ row37: 445, own445: 447 });
  all.push({ row37: 446, own446: 448 });
  all.push({ row37: 447, own447: 449 });
  all.push({ row37: 448, own448: 450 });
  all.push({ row37: 449, own449: 451 });
  all.push({ row37: 450, own450: 452 });
  all.push({ row37: 451, own451: 453 });
  all.push({ row37: 452, own452: 454 });
  all.push({ row37: 453, own453: 455 });
  all.push({ row37: 454, own454: 456 });
  all.push({ row37: 455, own455: 457 });
  all.push({ row37: 456, own456: 458 });
  all.push({ row38: 457, own457: 459 });
  all.push({ row38: 458, own458: 460 });
  all.push({ row38: 459, own459: 461 });
  all.push({ row38: 460, own460: 462 });
  all.push({ row38: 461, own461: 463 });
  all.push({ row38: 462, own462: 464 });
  all.push({ row38: 463, own463: 465 });
  all.push({ row38: 464, own464: 466 });
  all.push({ row38: 465, own465: 467 });
  all.push({ row38: 466, own466: 468 });
  all.push({ row38: 467, own467: 469 });
  all.push({ row38: 468, own468: 470 });
  all.push({ row39: 469, own469: 471 });
  all.push({ row39: 470, own470: 472 });
  all.push({ row39: 471, own471: 473 });
  all.push({ row39: 472, own472: 474 });
  all.push({ row39: 473, own473: 475 });
  all.push({ row39: 474, own474: 476 });
  all.push({ row39: 475, own475: 477 });
  all.push({ row39: 476, own476: 478 });
  all.push({ row39: 477, own477: 479 });
  all.push({ row39: 478, own478: 480 });
  all.push({ row39: 479, own479: 481 });
  all.push({ row39: 480, own480: 482 });
  all.push({ row40: 481, own481: 483 });
  all.push({ row40: 482, own482: 484 });
  all.push({ row40: 483, own483: 485 });
  all.push({ row40: 484, own484: 486 });
  all.push({ row40: 485, own485: 487 });
  all.push({ row40: 486, own486: 488 });
  all.push({ row40: 487, own487: 489 });
  all.push({ row40: 488, own488: 490 });
  all.push({ row40: 489, own489: 491 });
  all.push({ row40: 490, own490: 492 });
  all.push({ row40: 491, own491: 493 });
  all.push({ row40: 492, own492: 494 });
  all.push({ row41: 493, own493: 495 });
  all.push({ row41: 494, own494: 496 });
  all.push({ row41: 495, own495: 497 });
  all.push({ row41: 496, own496: 498 });
  all.push({ row41: 497, own497: 499 });
  all.push({ row41: 498, own498: 500 });
  all.push({ row41: 499, own499: 501 });
  all.push({ row41: 500, own500: 502 });
  all.push({ row41: 501, own501: 503 });
  all.push({ row41: 502, own502: 504 });
  all.push({ row41: 503, own503: 505 });
  all.push({ row41: 504, own504: 506 });
  all.push({ row42: 505, own505: 507 });
  all.push({ row42: 506, own506: 508 });
  all.push({ row42: 507, own507: 509 });
  all.push({ row42: 508, own508: 510 });
  all.push({ row42: 509, own509: 511 });
  all.push({ row42: 510, own510: 512 });
  all.push({ row42: 511, own511: 513 });
  all.push({ row42: 512, own512: 514 });
  all.push({ row42: 513, own513: 515 });
  all.push({ row42: 514, own514: 516 });
  all.push({ row42: 515, own515: 517 });
  all.push({ row42: 516, own516: 518 });
  all.push({ row43: 517, own517: 519 });
  all.push({ row43: 518, own518: 520 });
  all.push({ row43: 519, own519: 521 });
  all.push({ row43: 520, own520: 522 });
  all.push({ row43: 521, own521: 523 });
  all.push({ row43: 522, own522: 524 });
  all.push({ row43: 523, own523: 525 });
  all.push({ row43: 524, own524: 526 });
  all.push({ row43: 525, own525: 527 });
  all.push({ row43: 526, own526: 528 });
  all.push({ row43: 527, own527: 529 });
  all.push({ row43: 528, own528: 530 });
  all.push({ row44: 529, own529: 531 });
  all.push({ row44: 530, own530: 532 });
  all.push({ row44: 531, own531: 533 });
  all.push({ row44: 532, own532: 534 });
  all.push({ row44: 533, own533: 535 });
  all.push({ row44: 534, own534: 536 });
  all.push({ row44: 535, own535: 537 });
  all.push({ row44: 536, own536: 538 });
  all.push({ row44: 537, own537: 539 });
  all.push({ row44: 538, own538: 540 });
  all.push({ row44: 539, own539: 541 });
  all.push({ row44: 540, own540: 542 });
  all.push({ row45: 541, own541: 543 });
  all.push({ row45: 542, own542: 544 });
  all.push({ row45: 543, own543: 545 });
  all.push({ row45: 544, own544: 546 });
  all.push({ row45: 545, own545: 547 });
  all.push({ row45: 546, own546: 548 });
  all.push({ row45: 547, own547: 549 });
  all.push({ row45: 548, own548: 550 });
  all.push({ row45: 549, own549: 551 });
  all.push({ row45: 550, own550: 552 });
  all.push({ row45: 551, own551: 553 });
  all.push({ row45: 552, own552: 554 });
  all.push({ row46: 553, own553: 555 });
  all.push({ row46: 554, own554: 556 });
  all.push({ row46: 555, own555: 557 });
  all.push({ row46: 556, own556: 558 });
  all.push({ row46: 557, own557: 559 });
  all.push({ row46: 558, own558: 560 });
  all.push({ row46: 559, own559: 561 });
  all.push({ row46: 560, own560: 562 });
  all.push({ row46: 561, own561: 563 });
  all.push({ row46: 562, own562: 564 });
  all.push({ row46: 563, own563: 565 });
  all.push({ row46: 564, own564: 566 });
  all.push({ row47: 565, own565: 567 });
  all.push({ row47: 566, own566: 568 });
  all.push({ row47: 567, own567: 569 });
  all.push({ row47: 568, own568: 570 });
  all.push({ row47: 569, own569: 571 });
  all.push({ row47: 570, own570: 572 });
  all.push({ row47: 571, own571: 573 });
  all.push({ row47: 572, own572: 574 });
  all.push({ row47: 573, own573: 575 });
  all.push({ row47: 574, own574: 576 });
  all.push({ row47: 575, own575: 577 });
  all.push({ row47: 576, own576: 578 });
  all.push({ row48: 577, column0: 578, own577: 579 });
  all.push({ row48: 578, own578: 580 });
  all.push({ row48: 579, own579: 581 });
  all.push({ row48: 580, own580: 582 });
  all.push({ row48: 581, own581: 583 });
  all.push({ row48: 582, own582: 584 });
  all.push({ row48: 583, own583: 585 });
  all.push({ row48: 584, own584: 586 });
  all.push({ row48: 585, own585: 587 });
  all.push({ row48: 586, own586: 588 });
  all.push({ row48: 587, own587: 589 });
  all.push({ row48: 588, own588: 590 });
  all.push({ row49: 589, own589: 591 });
  all.push({ row49: 590, column1: 591, own590: 592 });
  all.push({ row49: 591, own591: 593 });
  all.push({ row49: 592, own592: 594 });
  all.push({ row49: 593, own593: 595 });
  all.push({ row49: 594, own594: 596 });
  all.push({ row49: 595, own595: 597 });
  all.push({ row49: 596, own596: 598 });
  all.push({ row49: 597, own597: 599 });
  all.push({ row49: 598, own598: 600 });
  all.push({ row49: 599, own599: 601 });
  all.push({ row49: 600, own600: 602 });
  all.push({ row50: 601, own601: 603 });
  all.push({ row50: 602, own602: 604 });
  all.push({ row50: 603, column2: 604, own603: 605 });
  all.push({ row50: 604, own604: 606 });
  all.push({ row50: 605, own605: 607 });
  all.push({ row50: 606, own606: 608 });
  all.push({ row50: 607, own607: 609 });
  all.push({ row50: 608, own608: 610 });
  all.push({ row50: 609, own609: 611 });
  all.push({ row50: 610, own610: 612 });
  all.push({ row50: 611, own611: 613 });
  all.push({ row50: 612, own612: 614 });
  all.push({ row51: 613, own613: 615 });
  all.push({ row51: 614, own614: 616 });
  all.push({ row51: 615, own615: 617 });
  all.push({ row51: 616, column3: 617, own616: 618 });
  all.push({ row51: 617, own617: 619 });
  all.push({ row51: 618, own618: 620 });
  all.push({ row51: 619, own619: 621 });
  all.push({ row51: 620, own620: 622 });
  all.push({ row51: 621, own621: 623 });
  all.push({ row51: 622, own622: 624 });
  all.push({ row51: 623, own623: 625 });
  all.push({ row51: 624, own624: 626 });
  all.push({ row52: 625, own625: 627 });
  all.push({ row52: 626, own626: 628 });
  all.push({ row52: 627, own627: 629 });
  all.push({ row52: 628, own628: 630 });
  all.push({ row52: 629, column4: 630, own629: 631 });
  all.push({ row52: 630, own630: 632 });
  all.push({ row52: 631, own631: 633 });
  all.push({ row52: 632, own632: 634 });
  all.push({ row52: 633, own633: 635 });
  all.push({ row52: 634, own634: 636 });
  all.push({ row52: 635, own635: 637 });
  all.push({ row52: 636, own636: 638 });
  all.push({ row53: 637, own637: 639 });
  all.push({ row53: 638, own638: 640 });
  all.push({ row53: 639, own639: 641 });
  all.push({ row53: 640, own640: 642 });
  all.push({ row53: 641, own641: 643 });
  all.push({ row53: 642, column5: 643, own642: 644 });
  all.push({ row53: 643, own643: 645 });
  all.push({ row53: 644, own644: 646 });
  all.push({ row53: 645, own645: 647 });
  all.push({ row53: 646, own646: 648 });
  all.push({ row53: 647, own647: 649 });
  all.push({ row53: 648, own648: 650 });
  all.push({ row54: 649, own649: 651 });
  all.push({ row54: 650, own650: 652 });
  all.push({ row54: 651, own651: 653 });
  all.push({ row54: 652, own652: 654 });
  all.push({ row54: 653, own653: 655 });
  all.push({ row54: 654, own654: 656 });
  all.push({ row54: 655, column6: 656, own655: 657 });
  all.push({ row54: 656, own656: 658 });
  all.push({ row54: 657, own657: 659 });
  all.push({ row54: 658, own658: 660 });
  all.push({ row54: 659, own659: 661 });
  all.push({ row54: 660, own660: 662 });
  all.push({ row55: 661, own661: 663 });
  all.push({ row55: 662, own662: 664 });
  all.push({ row55: 663, own663: 665 });
  all.push({ row55: 664, own664: 666 });
  all.push({ row55: 665, own665: 667 });
  all.push({ row55: 666, own666: 668 });
  all.push({ row55: 667, own667: 669 });
  all.push({ row55: 668, column7: 669, own668: 670 });
  all.push({ row55: 669, own669: 671 });
  all.push({ row55: 670, own670: 672 });
  all.push({ row55: 671, own671: 673 });
  all.push({ row55: 672, own672: 674 });
  all.push({ row56: 673, own673: 675 });
  all.push({ row56: 674, own674: 676 });
  all.push({ row56: 675, own675: 677 });
  all.push({ row56: 676, own676: 678 });
  all.push({ row56: 677, own677: 679 });
  all.push({ row56: 678, own678: 680 });
  all.push({ row56: 679, own679: 681 });
  all.push({ row56: 680, own680: 682 });
  all.push({ row56: 681, column8: 682, own681: 683 });
  all.push({ row56: 682, own682: 684 });
  all.push({ row56: 683, own683: 685 });
  all.push({ row56: 684, own684: 686 });
  all.push({ row57: 685, own685: 687 });
  all.push({ row57: 686, own686: 688 });
  all.push({ row57: 687, own687: 689 });
  all.push({ row57: 688, own688: 690 });
  all.push({ row57: 689, own689: 691 });
  all.push({ row57: 690, own690: 692 });
  all.push({ row57: 691, own691: 693 });
  all.push({ row57: 692, own692: 694 });
  all.push({ row57: 693, own693: 695 });
  all.push({ row57: 694, column9: 695, own694: 696 });
  all.push({ row57: 695, own695: 697 });
  all.push({ row57: 696, own696: 698 });
  all.push({ row58: 697, own697: 699 });
  all.push({ row58: 698, own698: 700 });
  all.push({ row58: 699, own699: 701 });
  all.push({ row58: 700, own700: 702 });
  all.push({ row58: 701, own701: 703 });
  all.push({ row58: 702, own702: 704 });
  all.push({ row58: 703, own703: 705 });
  all.push({ row58: 704, own704: 706 });
  all.push({ row58: 705, own705: 707 });
  all.push({ row58: 706, own706: 708 });
  all.push({ row58: 707, column10: 708, own707: 709 });
  all.push({ row58: 708, own708: 710 });
  all.push({ row59: 709, own709: 711 });
  all.push({ row59: 710, own710: 712 });
  all.push({ row59: 711, own711: 713 });
  all.push({ row59: 712, own712: 714 });
  all.push({ row59: 713, own713: 715 });
  all.push({ row59: 714, own714: 716 });
  all.push({ row59: 715, own715: 717 });
  all.push({ row59: 716, own716: 718 });
  all.push({ row59: 717, own717: 719 });
  all.push({ row59: 718, own718: 720 });
  all.push({ row59: 719, own719: 721 });
  all.push({ row59: 720, column11: 721, own720: 722 });
  all.push({ row60: 721, own721: 723 });
  all.push({ row60: 722, own722: 724 });
  all.push({ row60: 723, own723: 725 });
  all.push({ row60: 724, own724: 726 });
  all.push({ row60: 725, own725: 727 });
  all.push({ row60: 726, own726: 728 });
  all.push({ row60: 727, own727: 729 });
  all.push({ row60: 728, own728: 730 });
  all.push({ row60: 729, own729: 731 });
  all.push({ row60: 730, own730: 732 });
  all.push({ row60: 731, own731: 733 });
  all.push({ row60: 732, own732: 734 });
  all.push({ row61: 733, own733: 735 });
  all.push({ row61: 734, own734: 736 });
  all.push({ row61: 735, own735: 737 });
  all.push({ row61: 736, own736: 738 });
  all.push({ row61: 737, own737: 739 });
  all.push({ row61: 738, own738: 740 });
  all.push({ row61: 739, own739: 741 });
  all.push({ row61: 740, own740: 742 });
  all.push({ row61: 741, own741: 743 });
  all.push({ row61: 742, own742: 744 });
  all.push({ row61: 743, own743: 745 });
  all.push({ row61: 744, own744: 746 });
  all.push({ row62: 745, own745: 747 });
  all.push({ row62: 746, own746: 748 });
  all.push({ row62: 747, own747: 749 });
  all.push({ row62: 748, own748: 750 });
  all.push({ row62: 749, own749: 751 });
  all.push({ row62: 750, own750: 752 });
  all.push({ row62: 751, own751: 753 });
  all.push({ row62: 752, own752: 754 });
  all.push({ row62: 753, own753: 755 });
  all.push({ row62: 754, own754: 756 });
  all.push({ row62: 755, own755: 757 });
  all.push({ row62: 756, own756: 758 });
  all.push({ row63: 757, own757: 759 });
  all.push({ row63: 758, own758: 760 });
  all.push({ row63: 759, own759: 761 });
  all.push({ row63: 760, own760: 762 });
  all.push({ row63: 761, own761: 763 });
  all.push({ row63: 762, own762: 764 });
  all.push({ row63: 763, own763: 765 });
  all.push({ row63: 764, own764: 766 });
  all.push({ row63: 765, own765: 767 });
  all.push({ row63: 766, own766: 768 });
  all.push({ row63: 767, own767: 769 });
  all.push({ row63: 768, own768: 770 });
  all.push({ row64: 769, own769: 771 });
  all.push({ row64: 770, own770: 772 });
  all.push({ row64: 771, own771: 773 });
  all.push({ row64: 772, own772: 774 });
  all.push({ row64: 773, own773: 775 });
  all.push({ row64: 774, own774: 776 });
  all.push({ row64: 775, own775: 777 });
  all.push({ row64: 776, own776: 778 });
  all.push({ row64: 777, own777: 779 });
  all.push({ row64: 778, own778: 780 });
  all.push({ row64: 779, own779: 781 });
  all.push({ row64: 780, own780: 782 });
  all.push({ row65: 781, own781: 783 });
  all.push({ row65: 782, own782: 784 });
  all.push({ row65: 783, own783: 785 });
  all.push({ row65: 784, own784: 786 });
  all.push({ row65: 785, own785: 787 });
  all.push({ row65: 786, own786: 788 });
  all.push({ row65: 787, own787: 789 });
  all.push({ row65: 788, own788: 790 });
  all.push({ row65: 789, own789: 791 });
  all.push({ row65: 790, own790: 792 });
  all.push({ row65: 791, own791: 793 });
  all.push({ row65: 792, own792: 794 });
  all.push({ row66: 793, own793: 795 });
  all.push({ row66: 794, own794: 796 });
  all.push({ row66: 795, own795: 797 });
  all.push({ row66: 796, own796: 798 });
  all.push({ row66: 797, own797: 799 });
  all.push({ row66: 798, own798: 800 });
  all.push({ row66: 799, own799: 801 });
  all.push({ row66: 800, own800: 802 });
  all.push({ row66: 801, own801: 803 });
  all.push({ row66: 802, own802: 804 });
  all.push({ row66: 803, own803: 805 });
  all.push({ row66: 804, own804: 806 });
  all.push({ row67: 805, own805: 807 });
  all.push({ row67: 806, own806: 808 });
  all.push({ row67: 807, own807: 809 });
  all.push({ row67: 808, own808: 810 });
  all.push({ row67: 809, own809: 811 });
  all.push({ row67: 810, own810: 812 });
  all.push({ row67: 811, own811: 813 });
  all.push({ row67: 812, own812: 814 });
  all.push({ row67: 813, own813: 815 });
  all.push({ row67: 814, own814: 816 });
  all.push({ row67: 815, own815: 817 });
  all.push({ row67: 816, own816: 818 });
  all.push({ row68: 817, own817: 819 });
  all.push({ row68: 818, own818: 820 });
  all.push({ row68: 819, own819: 821 });
  all.push({ row68: 820, own820: 822 });
  all.push({ row68: 821, own821: 823 });
  all.push({ row68: 822, own822: 824 });
  all.push({ row68: 823, own823: 825 });
  all.push({ row68: 824, own824: 826 });
  all.push({ row68: 825, own825: 827 });
  all.push({ row68: 826, own826: 828 });
  all.push({ row68: 827, own827: 829 });
  all.push({ row68: 828, own828: 830 });
  all.push({ row69: 829, own829: 831 });
  all.push({ row69: 830, own830: 832 });
  all.push({ row69: 831, own831: 833 });
  all.push({ row69: 832, own832: 834 });
  all.push({ row69: 833, own833: 835 });
  all.push({ row69: 834, own834: 836 });
  all.push({ row69: 835, own835: 837 });
  all.push({ row69: 836, own836: 838 });
  all.push({ row69: 837, own837: 839 });
  all.push({ row69: 838, own838: 840 });
  all.push({ row69: 839, own839: 841 });
  all.push({ row69: 840, own840: 842 });
  all.push({ row70: 841, own841: 843 });
  all.push({ row70: 842, own842: 844 });
  all.push({ row70: 843, own843: 845 });
  all.push({ row70: 844, own844: 846 });
  all.push({ row70: 845, own845: 847 });
  all.push({ row70: 846, own846: 848 });
  all.push({ row70: 847, own847: 849 });
  all.push({ row70: 848, own848: 850 });
  all.push({ row70: 849, own849: 851 });
  all.push({ row70: 850, own850: 852 });
  all.push({ row70: 851, own851: 853 });
  all.push({ row70: 852, own852: 854 });
  all.push({ row71: 853, own853: 855 });
  all.push({ row71: 854, own854: 856 });
  all.push({ row71: 855, own855: 857 });
  all.push({ row71: 856, own856: 858 });
  all.push({ row71: 857, own857: 859 });
  all.push({ row71: 858, own858: 860 });
  all.push({ row71: 859, own859: 861 });
  all.push({ row71: 860, own860: 862 });
  all.push({ row71: 861, own861: 863 });
  all.push({ row71: 862, own862: 864 });
  all.push({ row71: 863, own863: 865 });
  all.push({ row71: 864, own864: 866 });
  all.push({ row72: 865, column0: 866, own865: 867 });
  all.push({ row72: 866, own866: 868 });
  all.push({ row72: 867, own867: 869 });
  all.push({ row72: 868, own868: 870 });
  all.push({ row72: 869, own869: 871 });
  all.push({ row72: 870, own870: 872 });
  all.push({ row72: 871, own871: 873 });
  all.push({ row72: 872, own872: 874 });
  all.push({ row72: 873, own873: 875 });
  all.push({ row72: 874, own874: 876 });
  all.push({ row72: 875, own875: 877 });
  all.push({ row72: 876, own876: 878 });
  all.push({ row73: 877, own877: 879 });
  all.push({ row73: 878, column1: 879, own878: 880 });
  all.push({ row73: 879, own879: 881 });
  all.push({ row73: 880, own880: 882 });
  all.push({ row73: 881, own881: 883 });
  all.push({ row73: 882, own882: 884 });
  all.push({ row73: 883, own883: 885 });
  all.push({ row73: 884, own884: 886 });
  all.push({ row73: 885, own885: 887 });
  all.push({ row73: 886, own886: 888 });
  all.push({ row73: 887, own887: 889 });
  all.push({ row73: 888, own888: 890 });
  all.push({ row74: 889, own889: 891 });
  all.push({ row74: 890, own890: 892 });
  all.push({ row74: 891, column2: 892, own891: 893 });
  all.push({ row74: 892, own892: 894 });
  all.push({ row74: 893, own893: 895 });
  all.push({ row74: 894, own894: 896 });
  all.push({ row74: 895, own895: 897 });
  all.push({ row74: 896, own896: 898 });
  all.push({ row74: 897, own897: 899 });
  all.push({ row74: 898, own898: 900 });
  all.push({ row74: 899, own899: 901 });
  all.push({ row74: 900, own900: 902 });
  all.push({ row75: 901, own901: 903 });
  all.push({ row75: 902, own902: 904 });
  all.push({ row75: 903, own903: 905 });
  all.push({ row75: 904, column3: 905, own904: 906 });
  all.push({ row75: 905, own905: 907 });
  all.push({ row75: 906, own906: 908 });
  all.push({ row75: 907, own907: 909 });
  all.push({ row75: 908, own908: 910 });
  all.push({ row75: 909, own909: 911 });
  all.push({ row75: 910, own910: 912 });
  all.push({ row75: 911, own911: 913 });
  all.push({ row75: 912, own912: 914 });
  all.push({ row76: 913, own913: 915 });
  all.push({ row76: 914, own914: 916 });
  all.push({ row76: 915, own915: 917 });
  all.push({ row76: 916, own916: 918 });
  all.push({ row76: 917, column4: 918, own917: 919 });
  all.push({ row76: 918, own918: 920 });
  all.push({ row76: 919, own919: 921 });
  all.push({ row76: 920, own920: 922 });
  all.push({ row76: 921, own921: 923 });
  all.push({ row76: 922, own922: 924 });
  all.push({ row76: 923, own923: 925 });
  all.push({ row76: 924, own924: 926 });
  all.push({ row77: 925, own925: 927 });
  all.push({ row77: 926, own926: 928 });
  all.push({ row77: 927, own927: 929 });
  all.push({ row77: 928, own928: 930 });
  all.push({ row77: 929, own929: 931 });
  all.push({ row77: 930, column5: 931, own930: 932 });
  all.push({ row77: 931, own931: 933 });
  all.push({ row77: 932, own932: 934 });
  all.push({ row77: 933, own933: 935 });
  all.push({ row77: 934, own934: 936 });
  all.push({ row77: 935, own935: 937 });
  all.push({ row77: 936, own936: 938 });
  all.push({ row78: 937, own937: 939 });
  all.push({ row78: 938, own938: 940 });
  all.push({ row78: 939, own939: 941 });
  all.push({ row78: 940, own940: 942 });
  all.push({ row78: 941, own941: 943 });
  all.push({ row78: 942, own942: 944 });
  all.push({ row78: 943, column6: 944, own943: 945 });
  all.push({ row78: 944, own944: 946 });
  all.push({ row78: 945, own945: 947 });
  all.push({ row78: 946, own946: 948 });
  all.push({ row78: 947, own947: 949 });
  all.push({ row78: 948, own948: 950 });
  all.push({ row79: 949, own949: 951 });
  all.push({ row79: 950, own950: 952 });
  all.push({ row79: 951, own951: 953 });
  all.push({ row79: 952, own952: 954 });
  all.push({ row79: 953, own953: 955 });
  all.push({ row79: 954, own954: 956 });
  all.push({ row79: 955, own955: 957 });
  all.push({ row79: 956, column7: 957, own956: 958 });
  all.push({ row79: 957, own957: 959 });
  all.push({ row79: 958, own958: 960 });
  all.push({ row79: 959, own959: 961 });
  all.push({ row79: 960, own960: 962 });
  all.push({ row80: 961, own961: 963 });
  all.push({ row80: 962, own962: 964 });
  all.push({ row80: 963, own963: 965 });
  all.push({ row80: 964, own964: 966 });
  all.push({ row80: 965, own965: 967 });
  all.push({ row80: 966, own966: 968 });
  all.push({ row80: 967, own967: 969 });
  all.push({ row80: 968, own968: 970 });
  all.push({ row80: 969, column8: 970, own969: 971 });
  all.push({ row80: 970, own970: 972 });
  all.push({ row80: 971, own971: 973 });
  all.push({ row80: 972, own972: 974 });
  all.push({ row81: 973, own973: 975 });
  all.push({ row81: 974, own974: 976 });
  all.push({ row81: 975, own975: 977 });
  all.push({ row81: 976, own976: 978 });
  all.push({ row81: 977, own977: 979 });
  all.push({ row81: 978, own978: 980 });
  all.push({ row81: 979, own979: 981 });
  all.push({ row81: 980, own980: 982 });
  all.push({ row81: 981, own981: 983 });
  all.push({ row81: 982, column9: 983, own982: 984 });
  all.push({ row81: 983, own983: 985 });
  all.push({ row81: 984, own984: 986 });
  all.push({ row82: 985, own985: 987 });
  all.push({ row82: 986, own986: 988 });
  all.push({ row82: 987, own987: 989 });
  all.push({ row82: 988, own988: 990 });
  all.push({ row82: 989, own989: 991 });
  all.push({ row82: 990, own990: 992 });
  all.push({ row82: 991, own991: 993 });
  all.push({ row82: 992, own992: 994 });
  all.push({ row82: 993, own993: 995 });
  all.push({ row82: 994, own994: 996 });
  all.push({ row82: 995, column10: 996, own995: 997 });
  all.push({ row82: 996, own996: 998 });
  all.push({ row83: 997, own997: 999 });
  all.push({ row83: 998, own998: 1000 });
  all.push({ row83: 999, own999: 1001 });
  all.push({ row83: 1000, own1000: 1002 });
  all.push({ row83: 1001, own1001: 1003 });
  all.push({ row83: 1002, own1002: 1004 });
  all.push({ row83: 1003, own1003: 1005 });
  all.push({ row83: 1004, own1004: 1006 });
  all.push({ row83: 1005, own1005: 1007 });
  all.push({ row83: 1006, own1006: 1008 });
  all.push({ row83: 1007, own1007: 1009 });
  all.push({ row83: 1008, column11: 1009, own1008: 1010 });
  all.push({ row84: 1009, own1009: 1011 });
  all.push({ row84: 1010, own1010: 1012 });
  all.push({ row84: 1011, own1011: 1013 });
  all.push({ row84: 1012, own1012: 1014 });
  all.push({ row84: 1013, own1013: 1015 });
  all.push({ row84: 1014, own1014: 1016 });
  all.push({ row84: 1015, own1015: 1017 });
  all.push({ row84: 1016, own1016: 1018 });
  all.push({ row84: 1017, own1017: 1019 });
  all.push({ row84: 1018, own1018: 1020 });
  all.push({ row84: 1019, own1019: 1021 });
  all.push({ row84: 1020, own1020: 1022 });
  all.push({ row85: 1021, own1021: 1023 });
  all.push({ row85: 1022, own1022: 1024 });
  all.push({ row85: 1023, own1023: 1025 });
  all.push({ row85: 1024, own1024: 1026 });
  all.push({ row85: 1025, own1025: 1027 });
  all.push({ row85: 1026, own1026: 1028 });
  all.push({ row85: 1027, own1027: 1029 });
  all.push({ row85: 1028, own1028: 1030 });
  all.push({ row85: 1029, own1029: 1031 });
  all.push({ row85: 1030, own1030: 1032 });
  all.push({ row85: 1031, own1031: 1033 });
  all.push({ row85: 1032, own1032: 1034 });
  all.push({ row86: 1033, own1033: 1035 });
  all.push({ row86: 1034, own1034: 1036 });
  all.push({ row86: 1035, own1035: 1037 });
  all.push({ row86: 1036, own1036: 1038 });
  all.push({ row86: 1037, own1037: 1039 });
  all.push({ row86: 1038, own1038: 1040 });
  all.push({ row86: 1039, own1039: 1041 });
  all.push({ row86: 1040, own1040: 1042 });
  all.push({ row86: 1041, own1041: 1043 });
  all.push({ row86: 1042, own1042: 1044 });
  all.push({ row86: 1043, own1043: 1045 });
  all.push({ row86: 1044, own1044: 1046 });
  all.push({ row87: 1045, own1045: 1047 });
  all.push({ row87: 1046, own1046: 1048 });
  all.push({ row87: 1047, own1047: 1049 });
  all.push({ row87: 1048, own1048: 1050 });
  all.push({ row87: 1049, own1049: 1051 });
  all.push({ row87: 1050, own1050: 1052 });
  all.push({ row87: 1051, own1051: 1053 });
  all.push({ row87: 1052, own1052: 1054 });
  all.push({ row87: 1053, own1053: 1055 });
  all.push({ row87: 1054, own1054: 1056 });
  all.push({ row87: 1055, own1055: 1057 });
  all.push({ row87: 1056, own1056: 1058 });
  all.push({ row88: 1057, own1057: 1059 });
  all.push({ row88: 1058, own1058: 1060 });
  all.push({ row88: 1059, own1059: 1061 });
  all.push({ row88: 1060, own1060: 1062 });
  all.push({ row88: 1061, own1061: 1063 });
  all.push({ row88: 1062, own1062: 1064 });
  all.push({ row88: 1063, own1063: 1065 });
  all.push({ row88: 1064, own1064: 1066 });
  all.push({ row88: 1065, own1065: 1067 });
  all.push({ row88: 1066, own1066: 1068 });
  all.push({ row88: 1067, own1067: 1069 });
  all.push({ row88: 1068, own1068: 1070 });
  all.push({ row89: 1069, own1069: 1071 });
  all.push({ row89: 1070, own1070: 1072 });
  all.push({ row89: 1071, own1071: 1073 });
  all.push({ row89: 1072, own1072: 1074 });
  all.push({ row89: 1073, own1073: 1075 });
  all.push({ row89: 1074, own1074: 1076 });
  all.push({ row89: 1075, own1075: 1077 });
  all.push({ row89: 1076, own1076: 1078 });
  all.push({ row89: 1077, own1077: 1079 });
  all.push({ row89: 1078, own1078: 1080 });
  all.push({ row89: 1079, own1079: 1081 });
  all.push({ row89: 1080, own1080: 1082 });
  all.push({ row90: 1081, own1081: 1083 });
  all.push({ row90: 1082, own1082: 1084 });
  all.push({ row90: 1083, own1083: 1085 });
  all.push({ row90: 1084, own1084: 1086 });
  all.push({ row90: 1085, own1085: 1087 });
  all.push({ row90: 1086, own1086: 1088 });
  all.push({ row90: 1087, own1087: 1089 });
  all.push({ row90: 1088, own1088: 1090 });
  all.push({ row90: 1089, own1089: 1091 });
  all.push({ row90: 1090, own1090: 1092 });
  all.push({ row90: 1091, own1091: 1093 });
  all.push({ row90: 1092, own1092: 1094 });
  all.push({ row91: 1093, own1093: 1095 });
  all.push({ row91: 1094, own1094: 1096 });
  all.push({ row91: 1095, own1095: 1097 });
  all.push({ row91: 1096, own1096: 1098 });
  all.push({ row91: 1097, own1097: 1099 });
  all.push({ row91: 1098, own1098: 1100 });
  all.push({ row91: 1099, own1099: 1101 });
  all.push({ row91: 1100, own1100: 1102 });
  all.push({ row91: 1101, own1101: 1103 });
  all.push({ row91: 1102, own1102: 1104 });
  all.push({ row91: 1103, own1103: 1105 });
  all.push({ row91: 1104, own1104: 1106 });
  all.push({ row92: 1105, own1105: 1107 });
  all.push({ row92: 1106, own1106: 1108 });
  all.push({ row92: 1107, own1107: 1109 });
  all.push({ row92: 1108, own1108: 1110 });
  all.push({ row92: 1109, own1109: 1111 });
  all.push({ row92: 1110, own1110: 1112 });
  all.push({ row92: 1111, own1111: 1113 });
  all.push({ row92: 1112, own1112: 1114 });
  all.push({ row92: 1113, own1113: 1115 });
  all.push({ row92: 1114, own1114: 1116 });
  all.push({ row92: 1115, own1115: 1117 });
  all.push({ row92: 1116, own1116: 1118 });
  all.push({ row93: 1117, own1117: 1119 });
  all.push({ row93: 1118, own1118: 1120 });
  all.push({ row93: 1119, own1119: 1121 });
  all.push({ row93: 1120, own1120: 1122 });
  all.push({ row93: 1121, own1121: 1123 });
  all.push({ row93: 1122, own1122: 1124 });
  all.push({ row93: 1123, own1123: 1125 });
  all.push({ row93: 1124, own1124: 1126 });
  all.push({ row93: 1125, own1125: 1127 });
  all.push({ row93: 1126, own1126: 1128 });
  all.push({ row93: 1127, own1127: 1129 });
  all.push({ row93: 1128, own1128: 1130 });
  all.push({ row94: 1129, own1129: 1131 });
  all.push({ row94: 1130, own1130: 1132 });
  all.push({ row94: 1131, own1131: 1133 });
  all.push({ row94: 1132, own1132: 1134 });
  all.push({ row94: 1133, own1133: 1135 });
  all.push({ row94: 1134, own1134: 1136 });
  all.push({ row94: 1135, own1135: 1137 });
  all.push({ row94: 1136, own1136: 1138 });
  all.push({ row94: 1137, own1137: 1139 });
  all.push({ row94: 1138, own1138: 1140 });
  all.push({ row94: 1139, own1139: 1141 });
  all.push({ row94: 1140, own1140: 1142 });
  all.push({ row95: 1141, own1141: 1143 });
  all.push({ row95: 1142, own1142: 1144 });
  all.push({ row95: 1143, own1143: 1145 });
  all.push({ row95: 1144, own1144: 1146 });
  all.push({ row95: 1145, own1145: 1147 });
  all.push({ row95: 1146, own1146: 1148 });
  all.push({ row95: 1147, own1147: 1149 });
  all.push({ row95: 1148, own1148: 1150 });
  all.push({ row95: 1149, own1149: 1151 });
  all.push({ row95: 1150, own1150: 1152 });
  all.push({ row95: 1151, own1151: 1153 });
  all.push({ row95: 1152, own1152: 1154 });
  return all;
}
function rowReader0(value: Row0): number {
  return value.row0;
}
function rowReader1(value: Row1): number {
  return value.row1;
}
function rowReader2(value: Row2): number {
  return value.row2;
}
function rowReader3(value: Row3): number {
  return value.row3;
}
function rowReader4(value: Row4): number {
  return value.row4;
}
function rowReader5(value: Row5): number {
  return value.row5;
}
function rowReader6(value: Row6): number {
  return value.row6;
}
function rowReader7(value: Row7): number {
  return value.row7;
}
function rowReader8(value: Row8): number {
  return value.row8;
}
function rowReader9(value: Row9): number {
  return value.row9;
}
function rowReader10(value: Row10): number {
  return value.row10;
}
function rowReader11(value: Row11): number {
  return value.row11;
}
function rowReader12(value: Row12): number {
  return value.row12;
}
function rowReader13(value: Row13): number {
  return value.row13;
}
function rowReader14(value: Row14): number {
  return value.row14;
}
function rowReader15(value: Row15): number {
  return value.row15;
}
function rowReader16(value: Row16): number {
  return value.row16;
}
function rowReader17(value: Row17): number {
  return value.row17;
}
function rowReader18(value: Row18): number {
  return value.row18;
}
function rowReader19(value: Row19): number {
  return value.row19;
}
function rowReader20(value: Row20): number {
  return value.row20;
}
function rowReader21(value: Row21): number {
  return value.row21;
}
function rowReader22(value: Row22): number {
  return value.row22;
}
function rowReader23(value: Row23): number {
  return value.row23;
}
function rowReader24(value: Row24): number {
  return value.row24;
}
function rowReader25(value: Row25): number {
  return value.row25;
}
function rowReader26(value: Row26): number {
  return value.row26;
}
function rowReader27(value: Row27): number {
  return value.row27;
}
function rowReader28(value: Row28): number {
  return value.row28;
}
function rowReader29(value: Row29): number {
  return value.row29;
}
function rowReader30(value: Row30): number {
  return value.row30;
}
function rowReader31(value: Row31): number {
  return value.row31;
}
function rowReader32(value: Row32): number {
  return value.row32;
}
function rowReader33(value: Row33): number {
  return value.row33;
}
function rowReader34(value: Row34): number {
  return value.row34;
}
function rowReader35(value: Row35): number {
  return value.row35;
}
function rowReader36(value: Row36): number {
  return value.row36;
}
function rowReader37(value: Row37): number {
  return value.row37;
}
function rowReader38(value: Row38): number {
  return value.row38;
}
function rowReader39(value: Row39): number {
  return value.row39;
}
function rowReader40(value: Row40): number {
  return value.row40;
}
function rowReader41(value: Row41): number {
  return value.row41;
}
function rowReader42(value: Row42): number {
  return value.row42;
}
function rowReader43(value: Row43): number {
  return value.row43;
}
function rowReader44(value: Row44): number {
  return value.row44;
}
function rowReader45(value: Row45): number {
  return value.row45;
}
function rowReader46(value: Row46): number {
  return value.row46;
}
function rowReader47(value: Row47): number {
  return value.row47;
}
function rowReader48(value: Row48): number {
  return value.row48;
}
function rowReader49(value: Row49): number {
  return value.row49;
}
function rowReader50(value: Row50): number {
  return value.row50;
}
function rowReader51(value: Row51): number {
  return value.row51;
}
function rowReader52(value: Row52): number {
  return value.row52;
}
function rowReader53(value: Row53): number {
  return value.row53;
}
function rowReader54(value: Row54): number {
  return value.row54;
}
function rowReader55(value: Row55): number {
  return value.row55;
}
function rowReader56(value: Row56): number {
  return value.row56;
}
function rowReader57(value: Row57): number {
  return value.row57;
}
function rowReader58(value: Row58): number {
  return value.row58;
}
function rowReader59(value: Row59): number {
  return value.row59;
}
function rowReader60(value: Row60): number {
  return value.row60;
}
function rowReader61(value: Row61): number {
  return value.row61;
}
function rowReader62(value: Row62): number {
  return value.row62;
}
function rowReader63(value: Row63): number {
  return value.row63;
}
function rowReader64(value: Row64): number {
  return value.row64;
}
function rowReader65(value: Row65): number {
  return value.row65;
}
function rowReader66(value: Row66): number {
  return value.row66;
}
function rowReader67(value: Row67): number {
  return value.row67;
}
function rowReader68(value: Row68): number {
  return value.row68;
}
function rowReader69(value: Row69): number {
  return value.row69;
}
function rowReader70(value: Row70): number {
  return value.row70;
}
function rowReader71(value: Row71): number {
  return value.row71;
}
function rowReader72(value: Row72): number {
  return value.row72;
}
function rowReader73(value: Row73): number {
  return value.row73;
}
function rowReader74(value: Row74): number {
  return value.row74;
}
function rowReader75(value: Row75): number {
  return value.row75;
}
function rowReader76(value: Row76): number {
  return value.row76;
}
function rowReader77(value: Row77): number {
  return value.row77;
}
function rowReader78(value: Row78): number {
  return value.row78;
}
function rowReader79(value: Row79): number {
  return value.row79;
}
function rowReader80(value: Row80): number {
  return value.row80;
}
function rowReader81(value: Row81): number {
  return value.row81;
}
function rowReader82(value: Row82): number {
  return value.row82;
}
function rowReader83(value: Row83): number {
  return value.row83;
}
function rowReader84(value: Row84): number {
  return value.row84;
}
function rowReader85(value: Row85): number {
  return value.row85;
}
function rowReader86(value: Row86): number {
  return value.row86;
}
function rowReader87(value: Row87): number {
  return value.row87;
}
function rowReader88(value: Row88): number {
  return value.row88;
}
function rowReader89(value: Row89): number {
  return value.row89;
}
function rowReader90(value: Row90): number {
  return value.row90;
}
function rowReader91(value: Row91): number {
  return value.row91;
}
function rowReader92(value: Row92): number {
  return value.row92;
}
function rowReader93(value: Row93): number {
  return value.row93;
}
function rowReader94(value: Row94): number {
  return value.row94;
}
function rowReader95(value: Row95): number {
  return value.row95;
}
function columnReader0(value: Column0): number {
  return value.column0;
}
function columnReader1(value: Column1): number {
  return value.column1;
}
function columnReader2(value: Column2): number {
  return value.column2;
}
function columnReader3(value: Column3): number {
  return value.column3;
}
function columnReader4(value: Column4): number {
  return value.column4;
}
function columnReader5(value: Column5): number {
  return value.column5;
}
function columnReader6(value: Column6): number {
  return value.column6;
}
function columnReader7(value: Column7): number {
  return value.column7;
}
function columnReader8(value: Column8): number {
  return value.column8;
}
function columnReader9(value: Column9): number {
  return value.column9;
}
function columnReader10(value: Column10): number {
  return value.column10;
}
function columnReader11(value: Column11): number {
  return value.column11;
}
function isColumn0(value: Row0 | Row24 | Row48 | Row72 | Row13 | Column0): number {
  return "column0" in value ? value.column0 : -2;
}
function isColumn1(value: Row1 | Row25 | Row49 | Row73 | Row14 | Column1): number {
  return "column1" in value ? value.column1 : -2;
}
function isColumn2(value: Row2 | Row26 | Row50 | Row74 | Row15 | Column2): number {
  return "column2" in value ? value.column2 : -2;
}
function isColumn3(value: Row3 | Row27 | Row51 | Row75 | Row16 | Column3): number {
  return "column3" in value ? value.column3 : -2;
}
function isColumn4(value: Row4 | Row28 | Row52 | Row76 | Row17 | Column4): number {
  return "column4" in value ? value.column4 : -2;
}
function isColumn5(value: Row5 | Row29 | Row53 | Row77 | Row18 | Column5): number {
  return "column5" in value ? value.column5 : -2;
}
function isColumn6(value: Row6 | Row30 | Row54 | Row78 | Row19 | Column6): number {
  return "column6" in value ? value.column6 : -2;
}
function isColumn7(value: Row7 | Row31 | Row55 | Row79 | Row20 | Column7): number {
  return "column7" in value ? value.column7 : -2;
}
function isColumn8(value: Row8 | Row32 | Row56 | Row80 | Row21 | Column8): number {
  return "column8" in value ? value.column8 : -2;
}
function isColumn9(value: Row9 | Row33 | Row57 | Row81 | Row22 | Column9): number {
  return "column9" in value ? value.column9 : -2;
}
function isColumn10(value: Row10 | Row34 | Row58 | Row82 | Row23 | Column10): number {
  return "column10" in value ? value.column10 : -2;
}
function isColumn11(value: Row11 | Row35 | Row59 | Row83 | Row24 | Column11): number {
  return "column11" in value ? value.column11 : -2;
}
const rowReaders: any[] = [rowReader0, rowReader1, rowReader2, rowReader3, rowReader4, rowReader5, rowReader6, rowReader7, rowReader8, rowReader9, rowReader10, rowReader11, rowReader12, rowReader13, rowReader14, rowReader15, rowReader16, rowReader17, rowReader18, rowReader19, rowReader20, rowReader21, rowReader22, rowReader23, rowReader24, rowReader25, rowReader26, rowReader27, rowReader28, rowReader29, rowReader30, rowReader31, rowReader32, rowReader33, rowReader34, rowReader35, rowReader36, rowReader37, rowReader38, rowReader39, rowReader40, rowReader41, rowReader42, rowReader43, rowReader44, rowReader45, rowReader46, rowReader47, rowReader48, rowReader49, rowReader50, rowReader51, rowReader52, rowReader53, rowReader54, rowReader55, rowReader56, rowReader57, rowReader58, rowReader59, rowReader60, rowReader61, rowReader62, rowReader63, rowReader64, rowReader65, rowReader66, rowReader67, rowReader68, rowReader69, rowReader70, rowReader71, rowReader72, rowReader73, rowReader74, rowReader75, rowReader76, rowReader77, rowReader78, rowReader79, rowReader80, rowReader81, rowReader82, rowReader83, rowReader84, rowReader85, rowReader86, rowReader87, rowReader88, rowReader89, rowReader90, rowReader91, rowReader92, rowReader93, rowReader94, rowReader95];
const columnReaders: any[] = [columnReader0, columnReader1, columnReader2, columnReader3, columnReader4, columnReader5, columnReader6, columnReader7, columnReader8, columnReader9, columnReader10, columnReader11];
const columnTests: any[] = [isColumn0, isColumn1, isColumn2, isColumn3, isColumn4, isColumn5, isColumn6, isColumn7, isColumn8, isColumn9, isColumn10, isColumn11];

const all = makeAll();
const holder: any = new Holder();
for (let round = 0; round < 3; round++) {
  let sumOfRows = 0;
  for (let which = 0; which < rowReaders.length; which++) for (const value of all) sumOfRows += rowReaders[which](value) | 0;
  console.log("rows", sumOfRows);
  for (let which = 0; which < columnReaders.length; which++) {
    const name = "column" + which;
    let numberThatFit = 0;
    let sumOfCalls = 0;
    let sumOfStores = 0;
    let sumOfTests = 0;
    for (const value of all) {
      const read = columnReaders[which](value);
      if (read !== undefined) numberThatFit++;
      sumOfCalls += read | 0;
      holder[name] = value;
      sumOfStores += holder[name][name] | 0;
      sumOfTests += columnTests[which](value);
    }
    console.log(name, numberThatFit, sumOfCalls, sumOfStores, sumOfTests);
  }
}
const typed: Holder = holder;
console.log(typed.column0.column0 | 0, typed.column11.column11 | 0);
