"""Every error the application raises on purpose. backend/exceptions/handlers.py turns them into HTTP responses."""


class APIError(Exception):
    """A request that cannot be served, with the HTTP status and the message shown to the user. extra: more fields of
    the JSON answer next to 'error' (for example retry_after); headers: response headers (for example Retry-After)."""
    def __init__(self, status, message, extra=None, headers=None):
        super().__init__(message)
        self.status, self.message = status, message
        self.extra, self.headers = extra or {}, headers or {}


class RateLimited(APIError):
    """429 from an in-memory request limit (middleware/rate_limit.py); `action` names the limit (recorded as a
    security event by the dispatcher). retry_after: seconds until a call is allowed again."""
    def __init__(self, action, message, retry_after=None):
        extra,headers = ({'retry_after':retry_after},{'Retry-After':str(retry_after)}) if retry_after else (None,None)
        super().__init__(429, message, extra, headers)
        self.action = action


AI_ERRORS = {
    'not_configured':'ยังไม่ได้เชื่อม AI (API Key ของ OpenAI หรือ Gemini หรือ n8n Webhook) สำหรับองค์กรนี้',
    'disabled':'ผู้ดูแลยังไม่ได้เปิดใช้ AI สำหรับงานนี้',
    'quota':'ถึงเพดานการใช้ AI ขององค์กรหรือบทสนทนาแล้ว',
    'unauthorized':'API Key หรือรหัสลับของ Webhook ใช้งานไม่ได้ กรุณาตรวจสอบคีย์ รหัสลับ และสิทธิ์โมเดล',
    'model_unavailable':'บัญชี AI นี้ใช้โมเดลที่ตั้งไว้ไม่ได้ (ไม่มีชื่อนี้ หรือเลิกให้บริการแล้ว) กรุณาเปลี่ยนชื่อโมเดลในตั้งค่าองค์กร → AI',
    'rate_limit':'บริการ AI จำกัดการใช้งาน หรือยอดใช้งานบัญชีไม่เพียงพอ',
    'provider':'บริการ AI ไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง',
    'webhook_missing':'n8n ไม่พบ Webhook นี้: ตรวจว่า workflow กด Publish แล้ว และใช้ Production URL (/webhook/…) ไม่ใช่ Test URL',
    'webhook_failed':'n8n รับงานแล้ว แต่ workflow ทำงานไม่สำเร็จ: เปิดแท็บ Executions ใน n8n เพื่อดูว่าหยุดที่โหนดไหน',
    'invalid_output':'AI ไม่ได้ให้คำตอบที่ตรวจสอบแหล่งอ้างอิงได้',
    'stale':'บทสนทนา ความรู้ การตั้งค่า หรือสิทธิ์เปลี่ยนไป กรุณาร่างใหม่',
    'timeout':'งาน AI หมดเวลา กรุณาลองใหม่ภายหลัง',
}


class AIError(Exception):
    """An AI job cannot run or its result cannot be used. `code` is a key of AI_ERRORS (stored on failed jobs)."""
    def __init__(self, code):
        self.code = code
        super().__init__(AI_ERRORS.get(code,AI_ERRORS['provider']))


CHANNEL_ERRORS = {
    'oauth_expired':'สิทธิ์ OAuth หมดอายุหรือถูกถอน กรุณาเชื่อมบัญชีอีเมลใหม่',
    'files_expired':'ลิงก์ไฟล์หมดอายุหรือถูกถอน กรุณาสร้างข้อความใหม่',
    'credentials':'ข้อมูลบัญชีหรือสิทธิ์การเชื่อมต่อไม่ถูกต้อง',
    'network':'ติดต่อบริการปลายทางไม่ได้ กรุณาตรวจเครือข่ายและชื่อเซิร์ฟเวอร์',
    'host':'ใช้ชื่อเซิร์ฟเวอร์สาธารณะเท่านั้น ไม่อนุญาตที่อยู่เครือข่ายภายใน',
    'disabled':'ช่องทางนี้ยังไม่เปิดใช้งาน',
    'changed':'การตั้งค่าหรือสิทธิ์เปลี่ยนไป กรุณาตรวจสอบก่อนส่งใหม่',
    'rejected':'บริการปลายทางปฏิเสธข้อความ กรุณาตรวจบัญชี ผู้รับ และข้อจำกัดบริการ',
    'temporary':'บริการปลายทางไม่พร้อมรับข้อความชั่วคราว',
    'credit':'เครดิตของผู้ให้บริการ SMS ไม่พอ กรุณาเติมเครดิตกับผู้ให้บริการ',
    'unknown':'ไม่ทราบผลการส่ง อาจส่งไปแล้ว กรุณาตรวจที่ปลายทางก่อนสร้างข้อความใหม่',
    'expired':'พ้นระยะตรวจข้อความซ้ำของ LINE แล้ว กรุณาตรวจที่ปลายทางก่อนสร้างข้อความใหม่',
    'size':'ข้ามอีเมลที่มีขนาดเกิน 8 MB',
    'media':'ไม่สามารถนำเข้าไฟล์นี้ได้ กรุณาให้เจ้าหน้าที่ตรวจสอบจากช่องทางต้นทาง',
    'ignored':'ข้ามข้อความอัตโนมัติหรือรูปแบบที่ไม่รองรับ',
    'mailbox_reset':'หมายเลขอ้างอิงกล่องจดหมายเปลี่ยน เริ่มรับจากข้อความใหม่เพื่อป้องกันการนำเข้าซ้ำ',
}


class ChannelError(Exception):
    """A LINE / Email provider problem. `code` is a key of CHANNEL_ERRORS; `retryable` means sending again is safe,
    `uncertain` means the message may already have been delivered."""
    def __init__(self,code,retryable=False,uncertain=False):
        self.code,self.retryable,self.uncertain = code,retryable,uncertain
        super().__init__(CHANNEL_ERRORS.get(code,CHANNEL_ERRORS['network']))
