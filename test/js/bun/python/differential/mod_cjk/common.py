# What the tests in this directory share. (Run by itself it does nothing.)
import binascii
import codecs

GROUPS = {
    'cn': ['gb2312', 'gbk', 'gb18030', 'hz'],
    'hk': ['big5hkscs'],
    'tw': ['big5', 'cp950'],
    'kr': ['euc_kr', 'cp949', 'johab'],
    'jp': ['shift_jis', 'cp932', 'euc_jp'],
    'jp2004': ['shift_jis_2004', 'shift_jisx0213', 'euc_jis_2004', 'euc_jisx0213'],
    'iso2022': ['iso2022_jp', 'iso2022_jp_1', 'iso2022_jp_2', 'iso2022_jp_2004', 'iso2022_jp_3', 'iso2022_jp_ext', 'iso2022_kr'],
}
ALL = [name for names in GROUPS.values() for name in names]


def crc(*parts):
    value = 0
    for part in parts:
        if isinstance(part, str):
            part = part.encode('utf-8', 'surrogatepass')
        elif not isinstance(part, bytes):
            part = repr(part).encode()
        value = binascii.crc32(part + b'|', value)
    return '%08x' % value


def show(title, digests, per_line=16):
    print(title)
    for i in range(0, len(digests), per_line):
        print('  %5x' % i, ' '.join(digests[i:i + per_line]))


def outcome(function, *args):
    """What the call returns, or what it raises, as something to print or to digest."""
    try:
        return function(*args)
    except (UnicodeEncodeError, UnicodeDecodeError) as e:
        return '%s %s %s %s %s' % (type(e).__name__, e.encoding, e.start, e.end, e.reason)
    except BaseException as e:
        return '%s: %s' % (type(e).__name__, e)


class Random:
    """The same numbers everywhere."""
    def __init__(self, seed):
        self.state = seed

    def below(self, n):
        self.state = (self.state * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.state >> 33) % n


POOL = ('Az09 ~\\\n', '\u3042\u30a2\u4e00\u4e9c', '\uff71\uff9f', '\xa5\u203e', '\u304b\u309a\u304b', '\xe6\u0300\xe6', '\u02e9\u02e5\u02e9', '\u31f7\u309a',
        '\xca\u0304\xca\u030c\xca', '\xea\u0304\xea', '\U0002000b\U00020089', '\U00020000\U0002a6d6', '\U0001f600', '\uac00\ud7a3\uac02\ub894', '\u3131\u3163',
        '\u4e2d\u6587\u56fd\u570b', '\u20ac\xb7\u2014\u2015\u30fb', '\ue000\ue757\uf8f0', '\xe9\u03b1\u0416', '\uff3c\uff5e\u301c\u2225', '\u9b1c\u9b1d\u4ff1', '\x80\xa0\xff', 'end\r\n')


def sample(name):
    """A text of all the kinds of characters that the codec has, and gives back as they were."""
    encode, decode = codecs.lookup(name)[:2]
    text = ''
    for piece in POOL:
        for character in piece:
            try:
                if decode(encode(character)[0])[0] == character:
                    text += character
            except UnicodeError:
                pass
        text += '.'
    return text
