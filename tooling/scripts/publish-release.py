#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通用 GitHub Release 发布器（零依赖，仅标准库）。

一次调用做完「建 Release（带说明）+ 上传一个资产」；被上层流水线按资产逐个调用，
重复调用天然幂等：Release 已存在则复用，同名资产已存在则跳过。

    python publish-release.py <资产路径> <说明md> [资产显示名]

环境变量（缺省自动推断，全部不入库）：
    GH_REPO / GH_TAG / GH_TARGET / GH_API_BASE / GH_DRAFT / GH_PRERELEASE / GH_DRY_RUN
    GH_TOKEN_ENV   指定 token 的环境变量名，默认 GH_TOKEN
    token 取值优先级：环境变量 -> 仓库根 .env（gitignored） -> git 凭据库（github.com）

不打印 token 内容，不把 token 写进任何文件。
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def repo_root():
    """从脚本目录按配置深度回退到仓库根；找不到 .git 时退回 cwd。"""
    d = HERE
    for _ in range(8):
        if os.path.isdir(os.path.join(d, ".git")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return os.getcwd()


def load_dotenv():
    """读仓库根 .env（不覆盖已有环境变量）。.env 必须被 .gitignore 忽略。"""
    for path in (os.path.join(repo_root(), ".env"), os.path.join(HERE, ".env")):
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip()
                if len(v) >= 2 and v[0] in ("'", '"') and v[-1] == v[0]:
                    v = v[1:-1]
                if k and k not in os.environ:
                    os.environ[k] = v


def read_text(path, fallbacks=("utf-8", "gbk", None)):
    """兼容中文 Windows 记事本以 GBK 保存的说明文件。"""
    import locale
    for enc in fallbacks:
        try:
            with open(path, encoding=enc or locale.getpreferredencoding(False)) as f:
                return f.read()
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise SystemExit("无法解码说明文件: %s" % path)


def sh(argv):
    """直接以参数列表调用可执行文件，不经 shell 解析。"""
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=30)
        return (out.stdout or "").strip()
    except Exception:
        return ""


def detect_repo():
    url = sh(["git", "remote", "get-url", "origin"]).replace("git@github.com:", "https://github.com/")
    if url.endswith(".git"):
        url = url[:-4]
    if "github.com/" in url:
        return url.split("github.com/", 1)[1].strip("/")
    return ""


def detect_tag():
    return sh(["git", "describe", "--tags", "--abbrev=0"])


def detect_branch():
    return sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]) or "main"


def fetch_token(host):
    """从 git 凭据库取 github.com 的 password（即 PAT）。

    必须用子进程直接喂 stdin：CMD 没有 printf，`.bat | git credential fill` 走不通。
    """
    try:
        proc = subprocess.run(
            ["git", "credential", "fill"],
            input="protocol=https\nhost=%s\n\n" % host,
            capture_output=True, text=True, timeout=30,
        )
        for line in (proc.stdout or "").splitlines():
            if line.startswith("password="):
                return line[len("password="):].strip()
    except Exception:
        pass
    return ""


load_dotenv()

API_BASE = os.environ.get("GH_API_BASE", "https://api.github.com").rstrip("/")
TOKEN_ENV = os.environ.get("GH_TOKEN_ENV", "GH_TOKEN")
REPO = (os.environ.get("GH_REPO") or "").strip()
TAG = (os.environ.get("GH_TAG") or "").strip()
TOKEN = (os.environ.get(TOKEN_ENV) or "").strip()
TARGET = (os.environ.get("GH_TARGET") or "").strip()
DRAFT = os.environ.get("GH_DRAFT", "0") == "1"
PRERELEASE = os.environ.get("GH_PRERELEASE", "0") == "1"
DRY_RUN = os.environ.get("GH_DRY_RUN", "0") == "1"


def api(path, data=None, method=None):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    last = None
    for _ in range(5):
        try:
            req = urllib.request.Request(
                API_BASE + path, data=body, method=method or ("POST" if body else "GET"),
                headers={
                    "Authorization": "Bearer " + TOKEN,
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "publish-release",
                    "Content-Type": "application/json",
                })
            with urllib.request.urlopen(req, timeout=90) as r:
                txt = r.read().decode("utf-8")
                return r.status, (json.loads(txt) if txt else None)
        except urllib.error.HTTPError as e:
            payload = e.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(payload) if payload else None
            except Exception:
                parsed = None
            last = (e.code, parsed or payload)
            if e.code in (401, 403, 404) and not isinstance(parsed, dict):
                return last
            if e.code in (409, 422):
                return e.code, parsed
            if e.code in (403, 429, 500, 502, 503):
                time.sleep(10)
                continue
            return last
        except Exception as e:
            last = ("EXC", str(e))
            time.sleep(10)
    return last


def release_by_tag(tag):
    st, resp = api("/repos/%s/releases/tags/%s" % (REPO, urllib.parse.quote(tag)))
    return resp if st == 200 and isinstance(resp, dict) else None


def main():
    if len(sys.argv) < 3:
        sys.exit("用法: python publish-release.py <资产路径> <说明md> [资产显示名]")
    asset = os.path.abspath(sys.argv[1])
    notes = os.path.abspath(sys.argv[2])
    display = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(asset)

    global REPO, TAG, TOKEN, TARGET
    REPO = REPO or detect_repo()
    TAG = TAG or detect_tag()
    TARGET = TARGET or detect_branch()
    if not TOKEN:
        TOKEN = fetch_token("github.com")
        if TOKEN:
            print("token 取自 git 凭据库（未打印、未落盘）")

    if not REPO:
        sys.exit("无法确定仓库（GH_REPO 未设且 origin 不含 github.com）")
    if not TAG:
        sys.exit("无法确定标签（GH_TAG 未设且无 git tag）")
    if not os.path.isfile(asset):
        sys.exit("资产不存在: %s" % asset)
    if not os.path.isfile(notes):
        sys.exit("说明文件不存在: %s" % notes)

    print("仓库=%s  标签=%s  目标=%s  draft=%s prerelease=%s" % (REPO, TAG, TARGET, DRAFT, PRERELEASE))
    body = read_text(notes)

    if DRY_RUN:
        print("\n[DRY-RUN] 以下动作【不会】执行：")
        print("  POST /repos/%s/releases  tag=%s name=%s body=%d 字符" % (REPO, TAG, display, len(body)))
        print("  UPLOAD %s  (%d bytes)" % (display, os.path.getsize(asset)))
        return

    if len(TOKEN) < 20:
        sys.exit("%s 缺失：环境变量、.env、git 凭据库三处都没取到 github.com 凭证" % TOKEN_ENV)

    st, resp = api("/repos/%s/releases" % REPO, {
        "tag_name": TAG, "target_commitish": TARGET, "name": display,
        "body": body, "draft": DRAFT, "prerelease": PRERELEASE,
    })
    if st in (200, 201):
        release = resp
    elif st in (409, 422):
        release = release_by_tag(TAG)
    else:
        print("创建 Release 失败:", st, json.dumps(resp, ensure_ascii=False)[:800])
        sys.exit(1)
    if not release or "upload_url" not in release:
        sys.exit("无法取得 Release 对象（tag 冲突且按 tag 查询失败）")
    print("release id: %s  html: %s" % (release.get("id"), release.get("html_url")))

    if display in {a.get("name") for a in (release.get("assets") or [])}:
        print("资产已存在，跳过上传:", display)
        return

    upload_url = release["upload_url"].split("{")[0] + "?name=" + urllib.parse.quote(display)
    size = os.path.getsize(asset)
    with open(asset, "rb") as f:
        data = f.read()
    print("上传中 %s  %d bytes ..." % (display, size))
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(upload_url, data=data, method="POST", headers={
                "Authorization": "Bearer " + TOKEN,
                "Accept": "application/vnd.github+json",
                "User-Agent": "publish-release",
                "Content-Type": "application/octet-stream",
                "Content-Length": str(size),
            })
            with urllib.request.urlopen(req, timeout=1800) as r:
                j = json.loads(r.read().decode("utf-8"))
                print("资产上传完成:", r.status, j.get("name"), j.get("size"), j.get("browser_download_url"))
            return
        except Exception as e:
            last = e
            print("  上传第 %d 次失败: %s" % (attempt + 1, str(e)[:200]))
            time.sleep(15)
    sys.exit("资产上传失败: %s" % last)


if __name__ == "__main__":
    main()
