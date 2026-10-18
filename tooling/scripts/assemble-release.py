#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""红线门禁 + 发布资产组装（配置驱动，零第三方依赖）。

做三件事，任何一件不过就非零退出，让上游流水线停在这里：

1. 门禁：对 release_gate.targets 逐条校验体积上下限、禁止外链资源/CDN/SRI 的正则、
   密钥形态正则；命中即失败并打印命中行，避免把破坏「单文件 / 默认零网络」红线或
   带凭据的文件发出去。
2. 组装：按 release_assets 的命名模板产出裸单文件与 zip；zip 条目同样来自配置，
   并二次校验 packaged_files_must_not_match（如 \\.env$）确实没进包。
3. 落盘：全部写到 paths.release_dir，供发布器按 glob 定位最新资产。

用法：python assemble-release.py --config tooling/scripts/config.json
所有名字/路径/阈值都来自 config，本文件不含项目字面量。
"""
import argparse
import json
import os
import re
import sys
import zipfile

PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def expand(text, mapping):
    if not isinstance(text, str):
        return text
    return PLACEHOLDER_RE.sub(lambda m: str(mapping.get(m.group(1), m.group(0))), text)


def expand_deep(obj, mapping):
    if isinstance(obj, dict):
        return {k: expand_deep(v, mapping) for k, v in obj.items()}
    if isinstance(obj, list):
        return [expand_deep(v, mapping) for v in obj]
    if isinstance(obj, str):
        return expand(obj, mapping)
    return obj


def fail(msg):
    print("  [门禁失败] " + msg)
    return msg


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


def locate_line(text, pos):
    return text.count("\n", 0, pos) + 1


def gate(cfg, repo_root):
    g = cfg.get("release_gate") or {}
    if not g.get("enabled"):
        print("  release_gate.enabled 非 true，跳过门禁")
        return []
    forbidden = [re.compile(p) for p in (g.get("forbidden_patterns") or [])]
    secrets = [re.compile(p) for p in (g.get("secret_patterns") or [])]
    errors = []
    for rel in g.get("targets") or []:
        path = os.path.join(repo_root, rel)
        if not os.path.isfile(path):
            errors.append(fail("目标文件不存在: %s" % rel))
            continue
        raw = read_bytes(path)
        size = len(raw)
        if g.get("max_bytes") and size > int(g["max_bytes"]):
            errors.append(fail("%s 体积 %d 超过上限 %s（单文件约束）" % (rel, size, g["max_bytes"])))
        if g.get("min_bytes") and size < int(g["min_bytes"]):
            errors.append(fail("%s 体积 %d 低于下限 %s（疑似内容丢失）" % (rel, size, g["min_bytes"])))
        text = raw.decode("utf-8", "replace")
        for rx in forbidden:
            for m in rx.finditer(text):
                errors.append(fail("%s:%d 命中禁止模式 %s -> %s" % (rel, locate_line(text, m.start()), rx.pattern, m.group(0)[:80])))
        for rx in secrets:
            for m in rx.finditer(text):
                errors.append(fail("%s:%d 疑似密钥泄漏，模式 %s" % (rel, locate_line(text, m.start()), rx.pattern)))
        if not errors:
            print("  通过：%s（%d 字节，外链/CDN/SRI/密钥 0 命中）" % (rel, size))
    return errors


def collect_entries(spec, repo_root, release_dir, mapping):
    """按 zip 条目声明收集 (磁盘路径, 包内路径)。"""
    out = []
    for item in spec.get("entries") or []:
        src = expand(item.get("src"), mapping)
        dest = expand(item.get("dest") or os.path.basename(src), mapping)
        full = os.path.join(release_dir, src) if item.get("generated_by") else os.path.join(repo_root, src)
        if not os.path.isfile(full):
            raise SystemExit("  [组装失败] zip 条目源不存在: %s（generated_by=%s）" % (src, item.get("generated_by")))
        out.append((full, dest))
    return out


def main():
    ap = argparse.ArgumentParser(description="红线门禁 + 发布资产组装")
    ap.add_argument("--config", required=True)
    args = ap.parse_args()

    cfg_path = os.path.abspath(args.config)
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)

    scripts_dir = os.path.dirname(cfg_path)
    depth = (cfg.get("paths") or {}).get("repo_root_depth") or "../.."
    repo_root = os.path.abspath(os.path.normpath(os.path.join(scripts_dir, depth)))
    release_dir = os.path.join(repo_root, (cfg.get("paths") or {}).get("release_dir") or "release")
    os.makedirs(release_dir, exist_ok=True)

    vs = cfg["project"]["version_source"]
    mapping = {"slug": cfg["project"]["slug"], "name": cfg["project"]["name"], "ver": ""}
    doc = os.path.join(repo_root, vs["file"])
    if os.path.isfile(doc):
        with open(doc, encoding="utf-8", errors="replace") as f:
            m = re.search(vs["pattern"], f.read())
        if m:
            mapping["ver"] = m.group(1)
    if not mapping["ver"]:
        raise SystemExit("无法从 %s 解析版本（pattern=%s）" % (vs["file"], vs["pattern"]))
    prefix = vs.get("strip_prefix")
    if prefix and mapping["ver"].startswith(prefix):
        mapping["ver"] = mapping["ver"][len(prefix):]

    print("项目=%s  版本=%s  仓库根=%s" % (cfg["project"]["name"], mapping["ver"], repo_root))

    print("[1/3] 红线门禁")
    errors = gate(cfg, repo_root)
    if errors:
        print("\n门禁未通过（%d 项）。修复后再发布；不要绕过。" % len(errors))
        return 1

    print("[2/3] 组装发布资产")
    spec = expand_deep(cfg["release_assets"], mapping)
    single = spec["single_html"]
    single_name = single["name_template"]
    src_single = os.path.join(repo_root, single["src"])
    dst_single = os.path.join(release_dir, single_name)
    with open(src_single, "rb") as f:
        data = f.read()
    with open(dst_single, "wb") as f:
        f.write(data)
    print("  裸单文件：%s（%d 字节）" % (single_name, len(data)))

    zip_spec = spec["zip"]
    zip_name = zip_spec["name_template"]
    zip_path = os.path.join(release_dir, zip_name)
    entries = collect_entries(zip_spec, repo_root, release_dir, mapping)
    banned = [re.compile(p) for p in (cfg["release_gate"].get("packaged_files_must_not_match") or [])]
    exclude = [re.compile(p) for p in (zip_spec.get("exclude_patterns") or [])]
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for full, dest in entries:
            if any(rx.search(dest) for rx in banned) or any(rx.search(dest) for rx in exclude):
                raise SystemExit("  [组装失败] 禁止条目进入发布包: %s" % dest)
            zf.write(full, dest)
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    for n in names:
        if any(rx.search(n) for rx in banned) or any(rx.search(n) for rx in exclude):
            raise SystemExit("  [组装失败] 发布包内含禁止文件: %s" % n)
    print("  发布包：%s（%d 字节，%d 个条目：%s）" % (zip_name, os.path.getsize(zip_path), len(names), ", ".join(names)))

    print("[3/3] 自检发布包内容")
    for n in names:
        if n.lower().endswith(".html"):
            body = ""
            with zipfile.ZipFile(zip_path) as zf, zf.open(n) as fh:
                body = fh.read().decode("utf-8", "replace")
            for rx in [re.compile(p) for p in (cfg["release_gate"].get("forbidden_patterns") or [])]:
                if rx.search(body):
                    raise SystemExit("  [自检失败] 包内 %s 命中禁止模式 %s" % (n, rx.pattern))
    print("  包内条目复查通过")

    print("\n组装完成，产物位于 %s" % release_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
