"""Dev server with cache-busting for ES modules."""
import http.server
import os
import re
import glob

os.chdir(os.path.dirname(os.path.abspath(__file__)))


def _version():
    """Compute version from newest mtime across all JS/JSON/HTML files."""
    newest = 0
    for pattern in ['js/*.js', 'config/*.json', '*.html']:
        for f in glob.glob(pattern):
            try:
                newest = max(newest, int(os.path.getmtime(f)))
            except OSError:
                pass
    return str(newest)

class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        # Strip query params for file lookup but serve the same file
        clean_path = self.path.split('?')[0]
        if clean_path != self.path:
            self.path = clean_path

        # For HTML files, rewrite script src to add cache-busting
        if self.path.endswith('.html') or self.path == '/':
            try:
                file_path = self.translate_path(self.path)
                if os.path.isdir(file_path):
                    file_path = os.path.join(file_path, 'index.html')
                with open(file_path, 'r') as f:
                    content = f.read()

                # Rewrite script src with version: src="js/main.js?v=3" → src="js/main.js?v=TIMESTAMP"
                v = _version()
                content = re.sub(
                    r'(src="[^"]+\.js)(\?v=[^"]*)?(")',
                    rf'\1?v={v}\3',
                    content
                )

                content_bytes = content.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.send_header('Content-Length', len(content_bytes))
                self.end_headers()
                self.wfile.write(content_bytes)
            except FileNotFoundError:
                self.send_error(404)
            return

        # For JS files, rewrite import statements to add cache-busting
        if self.path.endswith('.js'):
            try:
                file_path = self.translate_path(self.path)
                with open(file_path, 'r') as f:
                    content = f.read()

                v = _version()
                # Add version query to relative imports: './foo.js' → './foo.js?v=123'
                content = re.sub(
                    r"""(from\s+['"])(\./[^'"]+\.js)(['"])""",
                    rf'\1\2?v={v}\3',
                    content
                )
                content = re.sub(
                    r"""(import\s*\(\s*['"])(\./[^'"]+\.js)(['"])""",
                    rf'\1\2?v={v}\3',
                    content
                )
                # Add version query to fetch/load calls for JSON/OBJ files
                content = re.sub(
                    r"""(['"])([^'"]*\.(json|obj))(['"])""",
                    rf'\1\2?v={v}\4',
                    content
                )

                content_bytes = content.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript')
                self.send_header('Content-Length', len(content_bytes))
                self.end_headers()
                self.wfile.write(content_bytes)
            except FileNotFoundError:
                self.send_error(404)
            return

        super().do_GET()

if __name__ == '__main__':
    print(f'Serving on port 8765 (dynamic cache-busting from file mtime)')
    http.server.HTTPServer(('', 8765), DevHandler).serve_forever()
