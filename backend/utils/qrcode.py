"""QR codes (ISO/IEC 18004) for short text such as a PromptPay payment: byte mode, error correction level M,
versions 1-10 (up to 213 bytes). matrix() returns the modules (True = dark); data_url() draws them as an SVG image."""
import base64
from html import escape

# Level M: (error-correction codewords per block, [(blocks, data codewords per block), ...])
_LEVEL_M = {1:(10,[(1,16)]),2:(16,[(1,28)]),3:(26,[(1,44)]),4:(18,[(2,32)]),5:(24,[(2,43)]),6:(16,[(4,27)]),
            7:(18,[(4,31)]),8:(22,[(2,38),(2,39)]),9:(22,[(3,36),(2,37)]),10:(26,[(4,43),(1,44)])}
_ALIGNMENT = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]}
_MASKS = [lambda r,c:(r+c)%2==0, lambda r,c:r%2==0, lambda r,c:c%3==0, lambda r,c:(r+c)%3==0,
          lambda r,c:(r//2+c//3)%2==0, lambda r,c:r*c%2+r*c%3==0, lambda r,c:(r*c%2+r*c%3)%2==0,
          lambda r,c:((r+c)%2+r*c%3)%2==0]

# Arithmetic in GF(256) with the QR polynomial x^8+x^4+x^3+x^2+1.
_EXP,_LOG = [0]*512,[0]*256
_value = 1
for _i in range(255):
    _EXP[_i],_LOG[_value] = _value,_i
    _value <<= 1
    if _value & 0x100:
        _value ^= 0x11D
for _i in range(255,512):
    _EXP[_i] = _EXP[_i-255]


def _mul(a, b):
    return 0 if a==0 or b==0 else _EXP[_LOG[a]+_LOG[b]]


def _error_correction(data, count):
    """Reed-Solomon remainder: `count` codewords for one block."""
    generator = [1]
    for i in range(count):
        product = [0]*(len(generator)+1)
        for j,coefficient in enumerate(generator):
            product[j] ^= coefficient
            product[j+1] ^= _mul(coefficient,_EXP[i])
        generator = product
    remainder = list(data)+[0]*count
    for i in range(len(data)):
        factor = remainder[i]
        if factor:
            for j in range(1,len(generator)):
                remainder[i+j] ^= _mul(generator[j],factor)
    return remainder[len(data):]


def _codewords(text):
    """(version, the data and error-correction codewords in the order they are drawn)."""
    data = text.encode('utf-8')
    for version in range(1,11):
        ec,groups = _LEVEL_M[version]
        capacity = sum(blocks*size for blocks,size in groups)
        count_bits = 8 if version<10 else 16
        if 4+count_bits+8*len(data)<=capacity*8:
            break
    else:
        raise ValueError('ข้อความยาวเกินกว่าจะทำเป็น QR')
    bits = []
    def put(value, length):
        bits.extend((value>>i)&1 for i in range(length-1,-1,-1))
    put(0b0100,4)
    put(len(data),count_bits)
    for byte in data:
        put(byte,8)
    put(0,min(4,capacity*8-len(bits)))
    while len(bits)%8:
        bits.append(0)
    words = [int(''.join(map(str,bits[i:i+8])),2) for i in range(0,len(bits),8)]
    while len(words)<capacity:
        words.append(0xEC if (len(words)-len(bits)//8)%2==0 else 0x11)
    blocks,start = [],0
    for count,size in groups:
        for _ in range(count):
            blocks.append(words[start:start+size])
            start += size
    corrections = [_error_correction(block,ec) for block in blocks]
    ordered = [block[i] for i in range(max(map(len,blocks))) for block in blocks if i<len(block)]
    ordered += [block[i] for i in range(ec) for block in corrections]
    return version,ordered


def _function_patterns(version):
    """The fixed parts (finders, timing, alignment, reserved format and version areas); None where data goes."""
    size = 17+4*version
    grid = [[None]*size for _ in range(size)]
    for top,left in ((0,0),(0,size-7),(size-7,0)):
        for dr in range(-1,8):
            for dc in range(-1,8):
                r,c = top+dr,left+dc
                if 0<=r<size and 0<=c<size:
                    ring = max(abs(dr-3),abs(dc-3))
                    grid[r][c] = ring!=2 and ring!=4
    centers = _ALIGNMENT[version]
    for r in centers:
        for c in centers:
            if (r<9 and c<9) or (r<9 and c>size-10) or (r>size-10 and c<9):
                continue
            for dr in range(-2,3):
                for dc in range(-2,3):
                    grid[r+dr][c+dc] = max(abs(dr),abs(dc))!=1
    for i in range(size):
        if grid[6][i] is None:
            grid[6][i] = i%2==0
        if grid[i][6] is None:
            grid[i][6] = i%2==0
    for i in range(9):
        for r,c in ((8,i),(i,8)):
            if grid[r][c] is None:
                grid[r][c] = False
    for i in range(8):
        grid[8][size-1-i] = False
        grid[size-1-i][8] = False
    grid[size-8][8] = True
    if version>=7:
        remainder = version
        for _ in range(12):
            remainder = (remainder<<1)^((remainder>>11)*0x1F25)
        bits = version<<12|remainder
        for i in range(18):
            dark = (bits>>i)&1==1
            a,b = size-11+i%3,i//3
            grid[b][a] = grid[a][b] = dark
    return grid


def _draw_format(grid, mask):
    size = len(grid)
    data = mask   # level M is 00
    remainder = data
    for _ in range(10):
        remainder = (remainder<<1)^((remainder>>9)*0x537)
    bits = (data<<10|remainder)^0x5412
    bit = lambda i:(bits>>i)&1==1
    for i in range(6):
        grid[i][8] = bit(i)
    grid[7][8],grid[8][8],grid[8][7] = bit(6),bit(7),bit(8)
    for i in range(9,15):
        grid[8][14-i] = bit(i)
    for i in range(8):
        grid[8][size-1-i] = bit(i)
    for i in range(8,15):
        grid[size-15+i][8] = bit(i)
    grid[size-8][8] = True


def _penalty(grid):
    size,score = len(grid),0
    lines = grid+[list(column) for column in zip(*grid)]
    for line in lines:
        run = 1
        for i in range(1,size+1):
            if i<size and line[i]==line[i-1]:
                run += 1
                continue
            if run>=5:
                score += run-2
            run = 1
        text = ''.join('1' if v else '0' for v in line)
        score += 40*(text.count('10111010000')+text.count('00001011101'))
    for r in range(size-1):
        for c in range(size-1):
            if grid[r][c]==grid[r][c+1]==grid[r+1][c]==grid[r+1][c+1]:
                score += 3
    dark = sum(map(sum,grid))
    score += 10*(abs(dark*100//(size*size)-50)//5)
    return score


def matrix(text):
    version,words = _codewords(text)
    base = _function_patterns(version)
    size = len(base)
    fixed = [[value is not None for value in row] for row in base]
    data = [[bool(value) for value in row] for row in base]
    index,total = 0,len(words)*8
    right = size-1
    while right>0:
        if right==6:
            right -= 1
        upward = (right+1)&2==0
        for step in range(size):
            r = size-1-step if upward else step
            for c in (right,right-1):
                if not fixed[r][c] and index<total:
                    data[r][c] = (words[index>>3]>>(7-(index&7)))&1==1
                    index += 1
        right -= 2
    best = None
    for number,rule in enumerate(_MASKS):
        candidate = [[data[r][c]^(not fixed[r][c] and rule(r,c)) for c in range(size)] for r in range(size)]
        _draw_format(candidate,number)
        score = _penalty(candidate)
        if best is None or score<best[0]:
            best = (score,candidate)
    return best[1]


def data_url(text, label='QR code', border=4):
    """The QR code as an SVG data: URL, ready for <img src>."""
    grid = matrix(text)
    size = len(grid)+2*border
    path = ''.join(f'M{c+border} {r+border}h1v1h-1z' for r,row in enumerate(grid) for c,dark in enumerate(row) if dark)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges">'
           f'<title>{escape(label)}</title><rect width="{size}" height="{size}" fill="#fff"/><path d="{path}" fill="#000"/></svg>')
    return 'data:image/svg+xml;base64,'+base64.b64encode(svg.encode()).decode()
