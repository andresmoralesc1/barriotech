#!/usr/bin/env python3
"""
Helper: pull each part file listed in a backup registry JSON, using the
Telegram Bot API getFile → file_url. The same bot that uploaded the parts
must be the one whose token is supplied (file_ids are bot-scoped).

Usage:
  python3 _tg_restore.py --token <bot_token> --registry <reg.json> --out <dir>
"""
import argparse, json, os, sys, time
import urllib.request, urllib.parse

ap = argparse.ArgumentParser()
ap.add_argument("--token", required=True)
ap.add_argument("--registry", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()

with open(args.registry) as f:
    reg = json.load(f)

os.makedirs(args.out, exist_ok=True)

API = "https://api.telegram.org"

def get(path, retry=3):
    url = f"{API}/bot{args.token}/{path}"
    last_err = None
    for attempt in range(retry):
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                return json.load(r)
        except Exception as e:
            last_err = e
            time.sleep(1 + attempt)
    raise RuntimeError(f"GET {path} failed: {last_err}")

for i, part in enumerate(reg.get("parts", []), 1):
    name = part["name"]
    file_id = part.get("file_id")
    if not file_id or part.get("failed"):
        print(f"  [{i}] SKIP {name}: failed or missing file_id", file=sys.stderr)
        continue
    out = os.path.join(args.out, name)
    if os.path.exists(out) and os.path.getsize(out) == part.get("size"):
        print(f"  [{i}] CACHED {name}")
        continue
    info = get(f"getFile?file_id={urllib.parse.quote(file_id)}")
    if not info.get("ok"):
        print(f"  [{i}] FAIL {name}: {info.get('description')}", file=sys.stderr)
        continue
    file_path = info["result"]["file_path"]
    download = f"{API}/file/bot{args.token}/{file_path}"
    with urllib.request.urlopen(download, timeout=60) as r:
        data = r.read()
    with open(out, "wb") as o:
        o.write(data)
    got = len(data)
    expect = part.get("size", -1)
    status = "OK" if got == expect else "WARN size mismatch"
    print(f"  [{i}] {status} {name}  {got}B  (expected {expect}B)")

print("downloads done")
