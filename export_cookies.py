"""
Export Chrome/Edge cookies to Netscape cookies.txt format.
Works even when the browser is running by using win32 raw file reading.
"""
import os
import sys
import json
import base64
import sqlite3
import tempfile
from pathlib import Path

try:
    from Crypto.Cipher import AES
except ImportError:
    os.system(f'"{sys.executable}" -m pip install pycryptodome')
    from Crypto.Cipher import AES

import ctypes
import ctypes.wintypes
from ctypes import windll, byref, create_string_buffer

# ── Windows API constants ──
GENERIC_READ = 0x80000000
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
FILE_SHARE_DELETE = 0x00000004
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ('cbData', ctypes.wintypes.DWORD),
        ('pbData', ctypes.POINTER(ctypes.c_char))
    ]


def dpapi_decrypt(encrypted):
    blob_in = DATA_BLOB(len(encrypted), create_string_buffer(encrypted, len(encrypted)))
    blob_out = DATA_BLOB()
    if windll.crypt32.CryptUnprotectData(byref(blob_in), None, None, None, None, 0, byref(blob_out)):
        data = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        windll.kernel32.LocalFree(blob_out.pbData)
        return data
    return b''


def copy_locked_file(src_path, dst_path):
    """Copy a locked file using Windows CreateFileW with full sharing mode."""
    src = str(src_path)
    
    # Set up proper return/arg types
    CreateFileW = windll.kernel32.CreateFileW
    CreateFileW.restype = ctypes.wintypes.HANDLE
    CreateFileW.argtypes = [
        ctypes.wintypes.LPCWSTR, ctypes.wintypes.DWORD, ctypes.wintypes.DWORD,
        ctypes.c_void_p, ctypes.wintypes.DWORD, ctypes.wintypes.DWORD, ctypes.wintypes.HANDLE
    ]
    
    handle = CreateFileW(
        src,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        None,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        None
    )
    
    if handle is None or handle == ctypes.wintypes.HANDLE(-1).value:
        err = ctypes.GetLastError()
        raise OSError(f"CreateFileW failed with error {err} for {src}")
    
    try:
        # Get file size using GetFileSizeEx
        file_size = ctypes.c_longlong(0)
        if not windll.kernel32.GetFileSizeEx(handle, byref(file_size)):
            raise OSError("GetFileSizeEx failed")
        
        size = file_size.value
        if size <= 0:
            raise OSError(f"Invalid file size: {size}")
        
        # Read in chunks
        data = b''
        remaining = size
        chunk_size = 1024 * 1024  # 1MB chunks
        
        while remaining > 0:
            to_read = min(remaining, chunk_size)
            buf = create_string_buffer(to_read)
            bytes_read = ctypes.wintypes.DWORD(0)
            
            if not windll.kernel32.ReadFile(handle, buf, to_read, byref(bytes_read), None):
                break
            
            if bytes_read.value == 0:
                break
            
            data += buf.raw[:bytes_read.value]
            remaining -= bytes_read.value
        
        with open(dst_path, 'wb') as f:
            f.write(data)
        
        return len(data)
    finally:
        windll.kernel32.CloseHandle(handle)


def get_encryption_key(browser='chrome'):
    if browser == 'chrome':
        ls = Path(os.environ['LOCALAPPDATA']) / 'Google' / 'Chrome' / 'User Data' / 'Local State'
    else:
        ls = Path(os.environ['LOCALAPPDATA']) / 'Microsoft' / 'Edge' / 'User Data' / 'Local State'
    
    if not ls.exists():
        return None
    
    with open(ls, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    encrypted_key = base64.b64decode(data['os_crypt']['encrypted_key'])
    return dpapi_decrypt(encrypted_key[5:])  # Strip DPAPI prefix


def decrypt_value(encrypted_value, key):
    if not encrypted_value:
        return ''
    
    if encrypted_value[:3] in (b'v10', b'v20'):
        nonce = encrypted_value[3:15]
        payload = encrypted_value[15:]
        try:
            cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
            return cipher.decrypt_and_verify(payload[:-16], payload[-16:]).decode('utf-8', errors='replace')
        except Exception:
            return ''
    else:
        d = dpapi_decrypt(encrypted_value)
        return d.decode('utf-8', errors='replace') if d else ''


def get_cookie_db(browser='chrome'):
    if browser == 'chrome':
        return Path(os.environ['LOCALAPPDATA']) / 'Google' / 'Chrome' / 'User Data' / 'Default' / 'Network' / 'Cookies'
    return Path(os.environ['LOCALAPPDATA']) / 'Microsoft' / 'Edge' / 'User Data' / 'Default' / 'Network' / 'Cookies'


def export_cookies(output='cookies.txt', browser='chrome'):
    db_path = get_cookie_db(browser)
    if not db_path.exists():
        alt = 'edge' if browser == 'chrome' else 'chrome'
        db_path = get_cookie_db(alt)
        if not db_path.exists():
            print(f"ERROR: No cookie database found")
            return False
        browser = alt
    
    key = get_encryption_key(browser)
    if not key:
        print(f"ERROR: Could not get encryption key for {browser}")
        return False
    
    # Copy locked file using Windows API
    tmp_db = os.path.join(tempfile.gettempdir(), f'cookies_copy_{os.getpid()}.db')
    try:
        size = copy_locked_file(db_path, tmp_db)
        print(f"Copied {size} bytes from {browser} cookie database")
    except OSError as e:
        print(f"ERROR: {e}")
        return False
    
    try:
        conn = sqlite3.connect(tmp_db)
        cursor = conn.cursor()
        cursor.execute(
            'SELECT host_key, name, encrypted_value, path, expires_utc, is_secure '
            'FROM cookies'
        )
        
        cookies = []
        for host_key, name, enc_val, path, expires_utc, is_secure in cursor.fetchall():
            value = decrypt_value(enc_val, key)
            expires = int((expires_utc / 1000000) - 11644473600) if expires_utc > 0 else 0
            cookies.append((host_key, name, value, path or '/', max(expires, 0), bool(is_secure)))
        
        conn.close()
        
        with open(output, 'w', encoding='utf-8') as f:
            f.write('# Netscape HTTP Cookie File\n# Auto-exported\n\n')
            for host, name, value, path, expires, secure in cookies:
                domain_flag = 'TRUE' if host.startswith('.') else 'FALSE'
                secure_flag = 'TRUE' if secure else 'FALSE'
                f.write(f"{host}\t{domain_flag}\t{path}\t{secure_flag}\t{expires}\t{name}\t{value}\n")
        
        print(f"OK: {len(cookies)} cookies exported to {output}")
        return True
    
    except Exception as e:
        print(f"ERROR: {e}")
        return False
    finally:
        try:
            os.unlink(tmp_db)
        except:
            pass


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'cookies.txt'
    br = sys.argv[2] if len(sys.argv) > 2 else 'chrome'
    sys.exit(0 if export_cookies(out, br) else 1)
