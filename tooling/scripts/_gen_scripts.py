#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""脚本生成器：templates/*.tmpl + config.json -> 可执行脚本套件。

存在意义是把「编码策略」变成程序性保证而不是人的记性：
- .bat 以 text.encode("ascii") 强制纯 ASCII，含任何非 ASCII 字节直接抛错；
- .ps1 写入 UTF-8 **单个** BOM，并把双 BOM/前导多余 BOM 剥掉再写；
- 全部产物统一 CRLF、LF-only 输入自动升级；
- 幂等：重复生成字节一致。

改脚本请改 templates 与 config，不要手改生成物（下次生成会被覆盖）。
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, "templates")
CONFIG = os.path.join(HERE, "config.json")

# 模板 -> (产物文件名 key in config, 类型)
JOBS = [
    ("build-publish.bat.tmpl", "bat"),
    ("build-publish.ps1.tmpl", "ps1"),
    ("verify.ps1.tmpl", "ps1"),
    ("assemble-release.py.tmpl", "py"),
    ("publish-release.py.tmpl", "py"),
]

BOM = b"\xef\xbb\xbf"


def strip_boms(text):
    return text.lstrip("﻿")


def load_map():
    with open(CONFIG, encoding="utf-8") as f:
        cfg = json.load(f)
    entry = cfg["entries"][0]
    return cfg, {
        "REPO_ROOT_DEPTH": cfg["paths"]["repo_root_depth"],
        "CONFIG_FILE": entry.get("config_file", "config.json"),
        "CHCP": str(cfg["encoding"]["bat_chcp"]),
        "PS1_NAME": entry["ps1_file"],
        "BAT_FILE": entry["bat_file"],
        "SLUG": cfg["project"]["slug"],
    }


def render(text, mapping):
    for k, v in mapping.items():
        text = text.replace("{{" + k + "}}", v)
    left = re.findall(r"\{\{([A-Z_]+)\}\}", text)
    if left:
        raise SystemExit("模板残留未替换的占位符: %s" % sorted(set(left)))
    return text


def to_crlf(text):
    return text.replace("\r\n", "\n").replace("\n", "\r\n")


def write_bat(path, text):
    try:
        data = to_crlf(strip_boms(text)).encode("ascii")
    except UnicodeEncodeError as e:
        raise SystemExit("%s: .bat 含非 ASCII 字节，违反纯 ASCII 规则 -> %s" % (os.path.basename(path), e))
    with open(path, "wb") as f:
        f.write(data)
    return len(data), "ascii+crlf+nobom"


def write_ps1(path, text):
    data = BOM + to_crlf(strip_boms(text)).encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    n = 0
    i = 0
    while i + 2 < len(data):
        if data[i:i + 3] == BOM:
            n += 1
            i += 3
        else:
            break
    if n != 1:
        raise SystemExit("%s: BOM 数量为 %d，应为 1" % (os.path.basename(path), n))
    return len(data), "utf-8-bom(1)+crlf"


def write_py(path, text):
    data = to_crlf(strip_boms(text)).encode("utf-8")
    with open(path, "wb") as f:
        f.write(data)
    return len(data), "utf-8+crlf"


def main():
    cfg, mapping = load_map()
    entry = cfg["entries"][0]
    out_names = {
        "build-publish.bat.tmpl": entry["bat_file"],
        "build-publish.ps1.tmpl": entry["ps1_file"],
        "verify.ps1.tmpl": "verify.ps1",
        "assemble-release.py.tmpl": "assemble-release.py",
        "publish-release.py.tmpl": "publish-release.py",
    }
    for fname, kind in JOBS:
        src = os.path.join(TEMPLATES, fname)
        if not os.path.isfile(src):
            raise SystemExit("模板缺失: %s" % src)
        with open(src, encoding="utf-8-sig") as f:
            text = f.read()
        text = render(text, mapping)
        dst = os.path.join(HERE, out_names[fname])
        if kind == "bat":
            size, how = write_bat(dst, text)
        elif kind == "ps1":
            size, how = write_ps1(dst, text)
        else:
            size, how = write_py(dst, text)
        print("生成 %-24s %7d B  %s" % (os.path.basename(dst), size, how))
    print("\n完成。下一步运行 verify.ps1 做字节级/语法/冒烟校验。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
