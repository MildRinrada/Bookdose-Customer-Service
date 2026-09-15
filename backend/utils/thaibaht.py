"""An amount of money in Thai words, as written on invoices and receipts: 1,250.50 → หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์."""
from decimal import ROUND_HALF_UP, Decimal

DIGITS = ('ศูนย์','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า')
PLACES = ('','สิบ','ร้อย','พัน','หมื่น','แสน')


def _words(number, after_higher=False):
    """A whole number above zero. after_higher: a larger part (millions) comes before it, so a final 1 is เอ็ด."""
    if number>=1_000_000:
        millions,rest = divmod(number,1_000_000)
        return _words(millions,after_higher)+'ล้าน'+(_words(rest,True) if rest else '')
    text,out = str(number),''
    for i,char in enumerate(text):
        digit,place = int(char),len(text)-1-i
        if digit==0:
            continue
        if place==1 and digit==1:
            out += 'สิบ'
        elif place==1 and digit==2:
            out += 'ยี่สิบ'
        elif place==0 and digit==1 and (len(text)>1 or after_higher):
            out += 'เอ็ด'
        else:
            out += DIGITS[digit]+PLACES[place]
    return out


def baht_text(amount):
    satang_total = int((Decimal(amount)*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
    baht,satang = divmod(satang_total,100)
    text = _words(baht)+'บาท' if baht else ('' if satang else 'ศูนย์บาท')
    return text+(_words(satang)+'สตางค์' if satang else 'ถ้วน')
