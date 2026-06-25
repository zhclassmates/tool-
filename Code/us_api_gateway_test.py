
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# US backend/API gateway smoke test.
# Usage:
#   python3 us_api_gateway_test.py --base http://127.0.0.1:8081 --paths /health

import argparse, sys, requests
from urllib.parse import urljoin

def main():
    ap = argparse.ArgumentParser(description="US API Gateway smoke test")
    ap.add_argument("--base", default="http://127.0.0.1:8081", help="US backend base URL")
    ap.add_argument("--paths", nargs="*", default=["/health"], help="Paths to GET")
    ap.add_argument("--timeout", type=float, default=4.0)
    args = ap.parse_args()

    ok = True
    s = requests.Session()
    for path in args.paths:
        url = urljoin(args.base if args.base.endswith('/') else args.base + '/', path.lstrip('/'))
        try:
            r = s.get(url, timeout=args.timeout)
            print(f"[HTTP] GET {url} -> {r.status_code} | {r.text[:200].replace('\n',' ')}")
            ok = ok and (200 <= r.status_code < 300)
        except requests.RequestException as e:
            print(f"[HTTP] GET {url} -> ERROR {e}")
            ok = False
    print(f"\nRESULT={'PASS' if ok else 'FAIL'}")
    sys.exit(0 if ok else 2)

if __name__ == "__main__":
    main()
