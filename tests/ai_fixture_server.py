"""Browser-test-only server. Refuses to start without a disposable data directory."""
import os
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from backend.extensions import openai_client

def fake_provider(key,cfg,payload,mode):
    if mode=='test':
        result={'answer':'เชื่อมต่อ AI สำเร็จ','summary':'','needs_human':False,'citations':[]}
    else:
        article=payload['articles'][0]
        result={'answer':'เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านได้เลยค่ะ',
                'summary':'ลูกค้าต้องการดาวน์โหลดรายงานการอ่าน','needs_human':False,
                'citations':[{'article_id':article['id'],'quote':article['text'][:40]}]}
    return result,{'input_tokens':200,'output_tokens':80}

if __name__=='__main__':
    if 'bookdose-browser-ai-' not in os.environ.get('BOOKDOSE_DATA',''):
        raise SystemExit('Only run this fixture with a temporary browser-test directory')
    openai_client.call_provider=fake_provider
    app.main()
