
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 输入订单号，调用验证接口，并尽力提取证据或证据ID再回查。
#
# 用法示例：
#  1) 常见：POST /claims/verify，参数名 orderRef
#     python3 order_verify_test.py --base http://103.76.85.191:8082 --path /claims/verify --method POST --key orderRef --order 2938801601245126656
#
#  2) GET 查询：/claims/verify?orderRef=...
#     python3 order_verify_test.py --base http://103.76.85.191:8082 --path /claims/verify --method GET --key orderRef --order 2938801601245126656
#
#  3) 自定义证据读取路径（若返回 evidenceId）：
#     python3 order_verify_test.py --evidence-path /evidence/{id}
#
# 说明：
#  - 不强依赖具体后端字段。脚本会尝试从返回 JSON 中识别：eligible、payout、evidence/evidenceId/proof 等。
#  - 若拿到 evidenceId，会按 --evidence-path 规则回查（支持 /evidence/{id} 或 /admin/evidence/{id}）。
#  - 将把原始 JSON 持久化到 ./last_verify.json 和 ./last_evidence.json（当前工作目录）。

import argparse, sys, requests, os, json
from urllib.parse import urljoin

def save_json(path, obj):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        print(f"[FILE] 保存 {path}")
    except Exception as e:
        print(f"[FILE] 无法保存 {path}: {e}")

def pretty_keys(x):
    if isinstance(x, dict):
        return list(x.keys())
    return type(x).__name__

def extract_first(d, keys, default=None):
    for k in keys:
        if k in d:
            return d[k]
    return default

def main():
    ap = argparse.ArgumentParser(description="按订单号验证与证据拉取")
    ap.add_argument("--base", default="http://103.76.85.191:8082", help="服务 Base URL")
    ap.add_argument("--path", default="/claims/verify", help="验证接口路径（相对）")
    ap.add_argument("--method", default="POST", choices=["GET","POST"], help="HTTP 方法")
    ap.add_argument("--key", default="orderRef", help="订单号参数名，如 orderRef/orderId/oid")
    ap.add_argument("--order", required=True, help="订单号值")
    ap.add_argument("--exchange", default="", help="可选：交易所，如 okx/binance")
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--evidence-path", default="/evidence/{id},/admin/evidence/{id}", help="证据详情路径模板，逗号分隔，可含 {id}")
    args = ap.parse_args()

    s = requests.Session()
    url = urljoin(args.base if args.base.endswith("/") else args.base + "/", args.path.lstrip("/"))
    payload = {args.key: args.order}
    if args.exchange:
        payload["exchange"] = args.exchange

    print(f"[REQ] {args.method} {url}")
    print(f"[REQ] payload={payload}")

    try:
        if args.method == "GET":
            r = s.get(url, params=payload, timeout=args.timeout)
        else:
            r = s.post(url, json=payload, timeout=args.timeout)
    except requests.RequestException as e:
        print(f"[HTTP] 请求失败: {e}")
        sys.exit(2)

    print(f"[HTTP] {r.status_code}")
    text = r.text
    try:
        data = r.json()
    except ValueError:
        print(text[:400])
        print("[ERR] 返回不是 JSON")
        sys.exit(2)

    save_json("last_verify.json", data)

    # 提取关键信息
    eligible = extract_first(data, ["eligible","isEligible","eligibility"], None)
    payout = extract_first(data, ["payout","payoutAmount","payout_max","payoutMax"], None)
    evidence = extract_first(data, ["evidence","proof","fragments","proofs"], None)
    evidence_id = extract_first(data, ["evidenceId","proofId","id","evidence_id"], None)

    print("\n[SUMMARY]")
    print(f"eligible={eligible}")
    print(f"payout={payout}")
    print(f"evidence keys={pretty_keys(evidence)}")
    print(f"evidence_id={evidence_id}")

    # 若直接给了证据对象，保存
    if isinstance(evidence, (dict, list)):
        save_json("last_evidence.json", evidence)

    # 尝试回查证据详情
    if evidence_id:
        templates = [t.strip() for t in args.evidence_path.split(",") if t.strip()]
        for tpl in templates:
            path = tpl.replace("{id}", str(evidence_id)).lstrip("/")
            ev_url = urljoin(args.base if args.base.endswith("/") else args.base + "/", path)
            print(f"\n[REQ] GET {ev_url}")
            try:
                ev = s.get(ev_url, timeout=args.timeout)
                print(f"[HTTP] {ev.status_code}")
                evj = ev.json()
                save_json("last_evidence.json", evj)
                print("[OK] 证据详情已保存到 last_evidence.json")
                break
            except Exception as e:
                print(f"[WARN] 拉取失败：{e}")

    # 友好输出部分字段
    print("\n[RAW]")
    print(json.dumps(data, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
