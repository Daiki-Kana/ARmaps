import http.server
import socketserver
import socket
import os
import ssl
import subprocess

PORT_HTTPS = 8000
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

def ensure_ssl_cert():
    cert_dir = os.path.join(DIRECTORY, "node_modules", ".vite", "basic-ssl")
    cert_file = os.path.join(cert_dir, "_cert.pem")
    if not os.path.exists(cert_file):
        print("[SSL] Generating SSL certificate...")
        try:
            subprocess.run(
                ["node", "-e", "require('@vitejs/plugin-basic-ssl').getCertificate('node_modules/.vite/basic-ssl')"],
                cwd=DIRECTORY,
                capture_output=True,
                check=True
            )
        except Exception as e:
            print(f"[Warning] SSL certificate generation failed: {e}")
    return cert_file if os.path.exists(cert_file) else None

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

socketserver.TCPServer.allow_reuse_address = True
local_ip = get_local_ip()
cert_file = ensure_ssl_cert()

print("=" * 68)
print(" AR Rogaining App - HTTPS Mobile Server")
print("=" * 68)

if cert_file:
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_ctx.load_cert_chain(certfile=cert_file)
    
    print(f" [OK] HTTPS Server Started Successfully (Safari GPS / Camera Compatible)")
    print(f"   PC Browser URL:      https://localhost:{PORT_HTTPS}")
    print(f"   Safari / Mobile URL: https://{local_ip}:{PORT_HTTPS}")
    print("=" * 68)
    print(" [Safari / iPhone Access Instructions]")
    print(f" 1. Open https://{local_ip}:{PORT_HTTPS} in Safari on your iPhone.")
    print(" 2. When 'This Connection Is Not Private' (証明書が無効) appears:")
    print("    Tap 'Show Details' (詳細を表示) -> 'visit this website' (このウェブサイトを閲覧).")
    print(" 3. Tap 'Start AR Navigation' and allow Location & Camera permissions.")
    print("=" * 68)
else:
    print(f" [Warning] Started in HTTP Mode")
    print(f"   Safari and mobile browsers block GPS and Camera on HTTP.")
    print(f"   URL: http://{local_ip}:{PORT_HTTPS}")
    print("=" * 68)

try:
    with socketserver.TCPServer(("", PORT_HTTPS), Handler) as httpd:
        if cert_file:
            httpd.socket = ssl_ctx.wrap_socket(httpd.socket, server_side=True)
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped.")
