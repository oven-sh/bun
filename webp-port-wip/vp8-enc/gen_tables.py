import re, sys

src = open('/root/ref/libwebp/src/dec/tree_dec.c').read()
q = open('/root/ref/libwebp/src/dec/quant_dec.c').read()


def grab(text, name):
    i = text.index(name)
    i = text.index('= {', i) + 2
    depth = 0
    j = i
    while True:
        c = text[j]
        if c == '{':
            depth += 1
        if c == '}':
            depth -= 1
            if depth == 0:
                break
        j += 1
    return text[i:j + 1]


def conv(s):
    s = s.replace('{', '[').replace('}', ']')
    s = re.sub(r',\s*\]', ']', s)
    return s


out = []
out.append('''//! Constant tables of the VP8 format (RFC 6386), from `tree_dec.c`, `quant_dec.c` and `vp8_dec.c`.

use super::common::{NUM_BANDS, NUM_BMODES, NUM_CTX, NUM_PROBAS, NUM_TYPES};

/// Where the coefficients of a block are, in the order of the bitstream.
pub(crate) const ZIGZAG: [u8; 16] = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];

/// The band of each coefficient. The last entry stands for the position after the last coefficient.
pub(crate) const BANDS: [u8; 16 + 1] = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0];
''')
out.append('/// Paragraph 14.1\npub(crate) const DC_TABLE: [u8; 128] = ' + conv(grab(q, 'kDcTable[128]')) + ';\n')
out.append('pub(crate) const AC_TABLE: [u16; 128] = ' + conv(grab(q, 'kAcTable[128]')) + ';\n')
out.append('/// Paragraph 13.5\npub(crate) const COEFFS_PROBA0: [[[[u8; NUM_PROBAS]; NUM_CTX]; NUM_BANDS]; NUM_TYPES] = ' + conv(grab(src, 'CoeffsProba0[NUM_TYPES]')) + ';\n')
out.append('/// Paragraph 13.4\npub(crate) const COEFFS_UPDATE_PROBA: [[[[u8; NUM_PROBAS]; NUM_CTX]; NUM_BANDS]; NUM_TYPES] = ' + conv(grab(src, 'CoeffsUpdateProba[NUM_TYPES]')) + ';\n')
out.append('/// Paragraph 11.5: by the mode above, then by the mode to the left.\npub(crate) const BMODES_PROBA: [[[u8; NUM_BMODES - 1]; NUM_BMODES]; NUM_BMODES] = ' + conv(grab(src, 'kBModesProba[NUM_BMODES]')) + ';\n')
open(sys.argv[1], 'w').write('\n'.join(out))
