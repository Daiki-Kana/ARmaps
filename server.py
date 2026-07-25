import http.server
import socketserver
import socket
import os

PORT_HTTP = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

socketserver.TCPServer.allow_reuse_address = True
local_ip = get_local_ip()

print("=" * 68)
print(" AR Rogaining App - Mobile Stable HTTP Server")
print("=" * 68)
print(f" PC Browser URL:")
print(f"    http://localhost:{PORT_HTTP}")
print()
print(f" iOS / Android Mobile URL (Same Wi-Fi/LAN):")
print(f"    http://{local_ip}:{PORT_HTTP}")
print("=" * 68)

try:
    with socketserver.TCPServer(("", PORT_HTTP), Handler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped.")
