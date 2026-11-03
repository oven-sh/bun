# The codecs under io.TextIOWrapper, codecs.open(), str.encode() and the like.
import io, os, sys, tempfile
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

with tempfile.TemporaryDirectory() as directory:
    path = os.path.join(directory, 'text')
    for name in ALL:
        text = (sample(name).replace('\r', '') + '\n') * 3
        with open(path, 'w', encoding=name, newline='\n') as f:
            f.write(text)
        data = open(path, 'rb').read()
        print(name, crc(data), data == text.encode(name), str(data, name) == text, data.decode(name) == text, codecs.decode(data, name) == text, codecs.encode(text, name) == data, bytes(text, name) == data)
        with open(path, encoding=name, newline='\n') as f:
            print('  read', f.read() == text)
        # tell() and seek() go through the state of the decoder.
        with open(path, encoding=name, newline='\n') as f:
            places = []
            while True:
                # (The state of a decoder may be more than a TextIOWrapper can keep.)
                place = outcome(f.tell)
                piece = f.read(3)
                if not piece:
                    break
                places.append((place, piece))
            ok = True
            for place, piece in reversed(places):
                if isinstance(place, int):
                    f.seek(place)
                    ok = ok and f.read(3) == piece
            print('  seek', crc(places), ok, sorted({place for place, piece in places if isinstance(place, str)}))
        with open(path, encoding=name) as f:
            lines = []
            while True:
                place = outcome(f.tell)
                line = f.readline()
                if not line:
                    break
                lines.append((place, line))
            print('  lines', crc(lines), ''.join(line for place, line in lines) == text)
        with open(path, 'a', encoding=name, newline='\n') as f:
            f.write(text[:20])
        with open(path, 'r+', encoding=name, newline='\n') as f:
            f.read(5)
            print('  seek', outcome(lambda: f.seek(f.tell())))
            f.write('xyz')
        print('  changed', crc(open(path, 'rb').read()))
        with codecs.open(path, 'w', name) as f:
            f.write(text)
            f.writelines([text[:7], text[7:9]])
        with codecs.open(path, 'r', name) as f:
            print('  codecs.open', outcome(f.readline), crc(f.read(4)), crc(f.read()))
        print('  iter', b''.join(codecs.iterencode(text, name)) == data, ''.join(codecs.iterdecode([bytes([b]) for b in data], name)) == text)
        recoded = codecs.EncodedFile(io.BytesIO(data), 'utf-8', name)
        print('  EncodedFile', recoded.read() == text.encode())
        wrapper = io.TextIOWrapper(io.BytesIO(), encoding=name, errors='replace', newline='\n')
        wrapper.write('a\ud800b')
        wrapper.flush()
        print('  errors', wrapper.buffer.getvalue(), io.TextIOWrapper(io.BytesIO(b'a\xff\xffb'), encoding=name, errors='replace').read())

# The names by which the codecs are found.
for alias in ('sjis', 's_jis', 'shiftjis', 'csShiftJIS', 'ms932', 'windows-31j', 'mskanji', 'ms-kanji', 'eucjp', 'ujis', 'u-jis', 'EUC-JP', 'euc_jis2004', 'jisx0213', 'eucjisx0213', 'sjis_2004', 'shiftjis2004', 's_jisx0213',
              'iso-2022-jp', 'csiso2022jp', 'iso2022jp', 'iso-2022-jp-1', 'iso-2022-jp-2', 'iso-2022-jp-2004', 'iso-2022-jp-3', 'iso-2022-jp-ext', 'iso-2022-kr', 'csiso2022kr',
              'euckr', 'korean', 'ksc5601', 'ks_c-5601', 'ks_x-1001', 'ksx1001', 'uhc', '949', 'ms949', 'cp1361', 'ms1361', 'chinese', 'csiso58gb231280', 'euc-cn', 'euccn', 'eucgb2312-cn', 'gb2312-1980', 'gb2312-80', 'iso-ir-58',
              '936', 'cp936', 'ms936', 'gb18030-2000', 'hzgb', 'hz-gb', 'hz-gb-2312', 'big5-tw', 'csbig5', '950', 'ms950', 'big5-hkscs', 'hkscs', 'SHIFT_JIS', 'Big5', 'GBK', 'cp-949', 'x-sjis'):
    print(alias, outcome(lambda: codecs.lookup(alias).name))
for name in ALL:
    info = codecs.lookup(name)
    print(info.name, info._is_text_encoding, [cls.__mro__[1].__name__ for cls in (info.incrementalencoder, info.incrementaldecoder)], [cls.__mro__[2].__name__ for cls in (info.streamreader, info.streamwriter)], type(info.encode).__name__, info.encode.__name__, info.encode.__qualname__)
