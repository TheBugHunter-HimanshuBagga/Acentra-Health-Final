"""Adds every t('key', 'English default') used in web/src to web/src/i18n/ui.en.json (never overwrites an existing key).

Run, then translate the other languages:  node scripts/translate-json.mjs web/src/i18n/ui.en.json web/src/i18n/ui.others.json
"""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "web" / "src"
catalog = root / "i18n" / "ui.en.json"
data = json.loads(catalog.read_text(encoding="utf8"))
pattern = re.compile(r"""\bt\(\s*'([A-Za-z0-9_.]+)'\s*,\s*'((?:[^'\\]|\\.)*)'""")
added = 0
for f in list(root.rglob("*.tsx")) + list(root.rglob("*.ts")):
    if f.name.endswith(".test.tsx") or f.name.endswith(".test.ts"):
        continue
    for key, default in pattern.findall(f.read_text(encoding="utf8")):
        node = data
        parts = key.split(".")
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        if parts[-1] not in node:
            node[parts[-1]] = default.replace("\\'", "'")
            added += 1
catalog.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
print(f"added {added} keys")
