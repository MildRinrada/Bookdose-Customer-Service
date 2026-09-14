"""Article form validation."""
from backend.modules.knowledge.model import VISIBILITIES
from backend.utils.validation import require, field


def visibility(body):
    value = body.get('visibility','internal')
    require(value in VISIBILITIES,'สิทธิ์การอ่านไม่ถูกต้อง')
    return value


def article_fields(body):
    """(title, category, body)"""
    return field(body,'title',200),field(body,'category',80),field(body,'body',50000)
