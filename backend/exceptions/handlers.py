"""The HTTP status and message sent for each kind of error."""
import sqlite3

from backend.exceptions.errors import APIError, AIError, ChannelError


def error_response(error):
    """(status, message) for an expected error, or None for an unexpected one (answered as 500)."""
    if isinstance(error, APIError):
        return error.status, error.message
    if isinstance(error, AIError):
        return (429 if error.code=='quota' else 400), str(error)
    if isinstance(error, ChannelError):
        return (503 if error.code=='disabled' or error.retryable else 400), str(error)
    if isinstance(error, sqlite3.IntegrityError):
        return 409, 'ข้อมูลซ้ำหรือรายการที่อ้างอิงไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'
    return None
