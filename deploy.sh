#!/bin/bash
# 小红书阅读服务 - VPS 一键部署脚本
# 用法: bash deploy.sh

set -e

echo "=== 小红书阅读服务部署 ==="

# ---- 配置区（部署前修改这里）----
XHS_COOKIE="abRequestId=a031b516-41a6-5ce0-a5af-ebd4a3eb145c; xsecappid=xhs-pc-web; a1=19d9b1368405bb27giae5uhsazaqirf1943pficz50000401531; webId=1f069df6e2acf9131861a1438932ec04; gid=yjfjDyqzfYjKyjfjDyqKY43S482DDJWk30d2quu7xM0u0U28A3fii188848y2qy8iqWi2Dqf; ets=1781183341167; webBuild=6.21.0; loadts=1782024163262; unread=%22ub%22:%226a3268f500000001700bbb0%22%2C%22ue%22:%226a353d3c000000000702e361%22%2C%22uc%22:24; websectiga=8886be45f388a1ee7bf611a69f3e174cae48f1ea02c0f8ec3256031b8be9c7ee; sec_poison_id=00307a14-9ea9-475a-aba2-cf07a6ba0df6"
PORT=18080
# --------------------------------

# 检查 Docker
if ! command -v docker &> /dev/null; then
  echo "正在安装 Docker..."
  curl -fsSL https://get.docker.com | sh
fi

# 停止旧容器
docker rm -f xhs-reader 2>/dev/null || true

# 写入 Python 服务文件
mkdir -p /opt/xhs-reader
cat > /opt/xhs-reader/server.py << 'PYEOF'
import json
import hashlib
import time
import random
import string
import re
import urllib.request
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler

# ---- Cookie（由 deploy.sh 注入）----
import os
XHS_COOKIE = os.environ.get("XHS_COOKIE", "")

def make_headers(cookie):
    return {
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.xiaohongshu.com/",
        "Origin": "https://www.xiaohongshu.com",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
    }

def extract_note_id(url):
    """从小红书链接中提取 note_id"""
    # 标准格式: /explore/xxxx 或 /discovery/item/xxxx
    patterns = [
        r"xiaohongshu\.com/explore/([a-f0-9]+)",
        r"xiaohongshu\.com/discovery/item/([a-f0-9]+)",
        r"xhslink\.com/\S+",  # 短链需要跳转
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1) if "xhslink" not in p else None
    return None

def fetch_note(note_id, cookie):
    """调用小红书接口读取笔记"""
    api_url = f"https://www.xiaohongshu.com/api/sns/web/v1/feed"
    data = json.dumps({
        "source_note_id": note_id,
        "image_formats": ["jpg", "webp"],
        "extra": {"need_body_topic": "1"},
        "xsec_source": "pc_feed",
        "xsec_token": ""
    }).encode()

    headers = make_headers(cookie)
    headers["Content-Type"] = "application/json;charset=UTF-8"

    req = urllib.request.Request(api_url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            if result.get("success") and result.get("data", {}).get("items"):
                item = result["data"]["items"][0]["note_card"]
                title = item.get("title", "")
                desc = item.get("desc", "")
                author = item.get("user", {}).get("nickname", "")
                tag_list = [t["name"] for t in item.get("tag_list", [])]
                interact = item.get("interact_info", {})
                likes = interact.get("liked_count", "?")
                collects = interact.get("collected_count", "?")
                comments = interact.get("comment_count", "?")

                return {
                    "ok": True,
                    "title": title,
                    "author": author,
                    "content": desc,
                    "tags": tag_list,
                    "likes": likes,
                    "collects": collects,
                    "comments": comments,
                }
            else:
                return {"ok": False, "error": result.get("msg", "接口返回失败")}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def search_notes(keyword, cookie, page=1, sort="general"):
    """搜索小红书笔记"""
    api_url = "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes"
    params = urllib.parse.urlencode({
        "keyword": keyword,
        "page": page,
        "page_size": 10,
        "search_id": "",
        "sort": sort,
        "note_type": 0,
    })
    headers = make_headers(cookie)
    req = urllib.request.Request(f"{api_url}?{params}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            if result.get("success"):
                items = result.get("data", {}).get("items", [])
                notes = []
                for item in items:
                    note = item.get("note_card", {})
                    notes.append({
                        "id": item.get("id", ""),
                        "title": note.get("display_title", ""),
                        "author": note.get("user", {}).get("nickname", ""),
                        "likes": note.get("interact_info", {}).get("liked_count", "?"),
                        "url": f"https://www.xiaohongshu.com/explore/{item.get('id','')}",
                    })
                return {"ok": True, "notes": notes}
            else:
                return {"ok": False, "error": result.get("msg", "搜索失败")}
    except Exception as e:
        return {"ok": False, "error": str(e)}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # 关闭默认日志

    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(parsed.query))

        if parsed.path == "/health":
            self.send_json(200, {"ok": True, "msg": "running"})

        elif parsed.path == "/read":
            url = params.get("url", "")
            note_id = extract_note_id(url)
            if not note_id:
                self.send_json(400, {"ok": False, "error": "无法解析笔记 ID，请使用完整链接"})
                return
            result = fetch_note(note_id, XHS_COOKIE)
            self.send_json(200, result)

        elif parsed.path == "/search":
            keyword = params.get("q", "")
            if not keyword:
                self.send_json(400, {"ok": False, "error": "缺少参数 q"})
                return
            sort = params.get("sort", "general")
            result = search_notes(keyword, XHS_COOKIE, sort=sort)
            self.send_json(200, result)

        else:
            self.send_json(404, {"ok": False, "error": "Not found"})

print(f"小红书阅读服务启动，端口 {os.environ.get('PORT', 18080)}")
port = int(os.environ.get("PORT", 18080))
HTTPServer(("0.0.0.0", port), Handler).serve_forever()
PYEOF

# 写 Dockerfile
cat > /opt/xhs-reader/Dockerfile << 'DEOF'
FROM python:3.11-slim
WORKDIR /app
COPY server.py .
CMD ["python", "server.py"]
DEOF

# 构建并启动
cd /opt/xhs-reader
docker build -t xhs-reader .
docker run -d \
  --name xhs-reader \
  --restart unless-stopped \
  -p ${PORT}:18080 \
  -e XHS_COOKIE="${XHS_COOKIE}" \
  -e PORT=18080 \
  xhs-reader

echo ""
echo "✅ 部署完成！"
echo "服务地址: http://你的VPS_IP:${PORT}"
echo ""
echo "测试命令:"
echo "  curl http://localhost:${PORT}/health"
echo "  curl 'http://localhost:${PORT}/search?q=美食'"
echo "  curl 'http://localhost:${PORT}/read?url=https://www.xiaohongshu.com/explore/笔记ID'"
