
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# US/JP connectivity and HTTP sanity tests.
# Usage examples:
#   python3 us_server_test.py --base http://103.76.85.191:8082 --paths /health
#   python3 us_server_test.py --tcp 103.76.85.191:8082
# Notes:
#   - Defaults target the JP verify service on :8082 with /health.
#   - You can add more paths via --paths. Non-2xx counts as failure.

import argparse, sys, socket
from urllib.parse import urljoin
import requests

def check_tcp(host: str, port: int, timeout=3.0) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass

def parse_hostport(spec: str):
    host, port = spec.split(":", 1)
    return host, int(port)

def infer_hostport_from_base(base: str):
    try:
        hostport = base.split("://",1)[1].split("/",1)[0]
        if ":" in hostport:
            host, port = hostport.split(":",1)
            return host, int(port)
        return hostport, 80
    except Exception:
        return "103.76.85.191", 8082

def main():
    ap = argparse.ArgumentParser(description="US/JP connectivity sanity test")
    ap.add_argument("--base", default="http://103.76.85.191:8082", help="Base URL, e.g. http://103.76.85.191:8082")
    ap.add_argument("--paths", nargs="*", default=["/health"], help="HTTP paths to GET")
    ap.add_argument("--timeout", type=float, default=4.0, help="Per-request timeout seconds")
    ap.add_argument("--tcp", default="", help="Optional raw TCP check host:port, e.g. 103.76.85.191:8082")
    args = ap.parse_args()

    ok = True
    # TCP check
    if args.tcp:
        host, port = parse_hostport(args.tcp)
    else:
        host, port = infer_hostport_from_base(args.base)
    tcp_ok = check_tcp(host, port)
    print(f"[TCP] {host}:{port} -> {'OPEN' if tcp_ok else 'CLOSED'}")
    ok = ok and tcp_ok

    # HTTP checks
    s = requests.Session()
    for path in args.paths:
        url = urljoin(args.base if args.base.endswith('/') else args.base + '/', path.lstrip('/'))
        try:
            r = s.get(url, timeout=args.timeout)
            status = r.status_code
            brief = r.text[:200].replace("\n", " ")
            print(f"[HTTP] GET {url} -> {status} | {brief}")
            if not (200 <= status < 300):
                ok = False
        except requests.RequestException as e:
            print(f"[HTTP] GET {url} -> ERROR {e}")
            ok = False

    print(f"\nRESULT={'PASS' if ok else 'FAIL'}")
    sys.exit(0 if ok else 2)

if __name__ == "__main__":
    main()
