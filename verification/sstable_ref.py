"""Эталонная модель формата SSTable Cassandra 5.0 (oa/da) для калибровки калькулятора.

1. Разбор настоящих Data.db + CompressionInfo.db (проверка понимания формата).
2. Сериализация строк "TSDB".data_points по тем же правилам.
3. Сжатие чанками 16 КиБ через системную liblz4 1.9.4 (LZ4_compress_default),
   как LZ4Compressor (fast) в Cassandra: 4 байта длины + LZ4-блок, затем CRC32 4 байта.
"""
import ctypes, struct, zlib

_lz4 = ctypes.CDLL('liblz4.so.1')
_lz4.LZ4_compressBound.restype = ctypes.c_int
_lz4.LZ4_compress_default.restype = ctypes.c_int
_lz4.LZ4_decompress_safe.restype = ctypes.c_int


def lz4_compress(data: bytes) -> bytes:
    bound = _lz4.LZ4_compressBound(len(data))
    dst = ctypes.create_string_buffer(bound)
    n = _lz4.LZ4_compress_default(data, dst, len(data), bound)
    assert n > 0
    return dst.raw[:n]


def lz4_decompress(data: bytes, size: int) -> bytes:
    dst = ctypes.create_string_buffer(size)
    n = _lz4.LZ4_decompress_safe(data, dst, len(data), size)
    assert n == size, (n, size)
    return dst.raw


# ---------- vint (VIntCoding) ----------
def uvint_size(v: int) -> int:
    assert v >= 0
    mag = max(1, v.bit_length())
    return min(9, (639 - (64 - mag) * 0 - mag * 9) >> 6) if False else _uvsize(v)


def _uvsize(v):
    # 1 байт: 7 бит, далее +7 бит на байт, 9 байт: 64 бита
    for n in range(1, 9):
        if v < (1 << (7 * n)):
            return n
    return 9


def write_uvint(v: int) -> bytes:
    n = _uvsize(v)
    if n == 1:
        return bytes([v])
    if n == 9:
        return bytes([0xFF]) + v.to_bytes(8, 'big')
    extra = n - 1
    first_mask = (0xFF << (8 - extra)) & 0xFF  # ведущие единицы
    b = v.to_bytes(n, 'big')
    return bytes([b[0] | first_mask]) + b[1:]


def read_uvint(buf: bytes, pos: int):
    first = buf[pos]
    if first < 0x80:
        return first, pos + 1
    extra = 0
    m = 0x80
    while first & m:
        extra += 1
        m >>= 1
    val = first & (0xFF >> extra) if extra < 8 else 0
    for i in range(extra):
        val = (val << 8) | buf[pos + 1 + i]
    return val, pos + 1 + extra


# ---------- CompressionInfo + Data.db ----------
def read_utf(b, p):
    n = struct.unpack('>H', b[p:p + 2])[0]
    return b[p + 2:p + 2 + n].decode(), p + 2 + n


def read_compression_info(path):
    b = open(path, 'rb').read()
    p = 0
    name, p = read_utf(b, p)
    (nopt,) = struct.unpack('>i', b[p:p + 4]); p += 4
    opts = {}
    for _ in range(nopt):
        k, p = read_utf(b, p); v, p = read_utf(b, p); opts[k] = v
    chunk_len, max_comp = struct.unpack('>ii', b[p:p + 8]); p += 8
    (data_len,) = struct.unpack('>q', b[p:p + 8]); p += 8
    (cnt,) = struct.unpack('>i', b[p:p + 4]); p += 4
    offs = list(struct.unpack('>%dq' % cnt, b[p:p + 8 * cnt]))
    return dict(name=name, opts=opts, chunk_len=chunk_len, max_comp=max_comp, data_len=data_len, offsets=offs, size=len(b))


def decompress_data(data_path, ci):
    raw = open(data_path, 'rb').read()
    out = bytearray()
    offs = ci['offsets'] + [len(raw)]
    for i in range(len(ci['offsets'])):
        a, z = offs[i], offs[i + 1]
        chunk = raw[a:z - 4]
        crc = struct.unpack('>I', raw[z - 4:z])[0]
        assert zlib.crc32(chunk) & 0xFFFFFFFF == crc, 'CRC chunk %d' % i
        want = min(ci['chunk_len'], ci['data_len'] - len(out))
        (ulen,) = struct.unpack('<i', chunk[:4])
        assert ulen == want, (ulen, want)
        out += lz4_decompress(chunk[4:], ulen)
    assert len(out) == ci['data_len']
    return bytes(out), len(raw)


def parse_data(buf, clustering_types, regular_types):
    """Разбор потока партиций. types: 'text' (vint длина) или число байт фиксированного типа."""
    p = 0
    stats = dict(partitions=0, rows=0, cells=0, row_bytes=0)
    while p < len(buf):
        pstart = p
        (klen,) = struct.unpack('>H', buf[p:p + 2]); p += 2 + klen
        dt = buf[p]
        p += 1 if dt & 0x80 else 12
        stats['partitions'] += 1
        prev = p - pstart  # первая строка ссылается на заголовок партиции
        while True:
            start = p
            flags = buf[p]; p += 1
            if flags & 0x01:  # END_OF_PARTITION
                break
            assert not flags & 0x02, 'marker'
            ext = 0
            if flags & 0x80:
                ext = buf[p]; p += 1
            assert not ext & 0x01, 'static'
            hdr = 0
            if clustering_types:
                hdr, p = read_uvint(buf, p)
            for i, t in enumerate(clustering_types):
                if (hdr >> (2 * i)) & 3:
                    continue
                if t == 'text':
                    n, p = read_uvint(buf, p); p += n
                else:
                    p += t
            body, p = read_uvint(buf, p)
            prev_size, p2 = read_uvint(buf, p)
            assert prev_size == prev, (prev_size, prev)
            body_start = p
            p = p2
            if flags & 0x04:
                _, p = read_uvint(buf, p)
            if flags & 0x08:
                _, p = read_uvint(buf, p); _, p = read_uvint(buf, p)
            if flags & 0x10:
                _, p = read_uvint(buf, p); _, p = read_uvint(buf, p)
            present = list(range(len(regular_types)))
            if not flags & 0x20:
                missing, p = read_uvint(buf, p)
                present = [i for i in present if not (missing >> i) & 1]
            for i in present:
                cf = buf[p]; p += 1
                if not cf & 0x08:  # USE_ROW_TIMESTAMP
                    _, p = read_uvint(buf, p)
                deleted, expiring, use_ttl = cf & 0x01, cf & 0x02, cf & 0x10
                if (deleted or expiring) and not use_ttl:
                    _, p = read_uvint(buf, p)
                if expiring and not use_ttl:
                    _, p = read_uvint(buf, p)
                if not cf & 0x04:  # HAS_EMPTY_VALUE
                    t = regular_types[i]
                    if t == 'text':
                        n, p = read_uvint(buf, p); p += n
                    else:
                        p += t
                stats['cells'] += 1
            assert p - body_start == body, ('row body', p - body_start, body)
            prev = p - start
            stats['rows'] += 1
            stats['row_bytes'] += p - start
    assert p == len(buf)
    return stats
