#!/usr/bin/env python3
"""
Local dev server for Canopy.
Serves static files AND proxies POST /api/claude → Anthropic API.

Usage:
    ANTHROPIC_API_KEY=sk-ant-... python3 server.py
    # or export the key first, then:
    python3 server.py

Defaults to port 8080. Override with PORT env var.
"""

import http.server
import json
import os
import socketserver
import sys
import urllib.request
import urllib.error
from functools import partial

PORT = int(os.environ.get('PORT', 8080))
ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
ANTHROPIC_VERSION = '2023-06-01'


socketserver.TCPServer.allow_reuse_address = True


class CanopyHandler(http.server.SimpleHTTPRequestHandler):
    """Static file server with /api/claude POST proxy."""

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/claude':
            self._proxy_claude()
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()

    def _proxy_claude(self):
        api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
        if not api_key:
            self._json(500, {'error': {'message': 'ANTHROPIC_API_KEY is not set. Export it before starting the server.'}})
            return

        length = int(self.headers.get('Content-Length', 0))
        raw = self.rfile.read(length)

        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            self._json(400, {'error': {'message': 'Invalid JSON body'}})
            return

        req = urllib.request.Request(
            ANTHROPIC_API_URL,
            data=json.dumps(body).encode(),
            headers={
                'Content-Type': 'application/json',
                'x-api-key': api_key,
                'anthropic-version': ANTHROPIC_VERSION,
            },
            method='POST',
        )

        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.status
                data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            status = e.code
            try:
                data = json.loads(e.read())
            except Exception:
                data = {'error': {'message': f'Anthropic API error {e.code}'}}
        except Exception as e:
            self._json(502, {'error': {'message': f'Upstream request failed: {e}'}})
            return

        self._json(status, data)

    def _json(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, fmt, *args):
        # Slightly nicer logs
        sys.stderr.write(f'  {self.address_string()} - {fmt % args}\n')


def main():
    api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        print('\n⚠️  Warning: ANTHROPIC_API_KEY is not set.')
        print('   The org chart and filters will work, but the AI panel will return an error.')
        print('   To enable AI: export ANTHROPIC_API_KEY=sk-ant-... then restart.\n')

    with socketserver.TCPServer(('', PORT), CanopyHandler) as httpd:
        print(f'🌿 Canopy dev server running at http://localhost:{PORT}')
        print(f'   AI proxy: {"✅ active" if api_key else "❌ no API key"}')
        print('   Press Ctrl+C to stop.\n')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nStopped.')


if __name__ == '__main__':
    main()
