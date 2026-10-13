#!/usr/bin/env python3
"""编排调用 baidu-search / xiaohongshu-market-research / tieba-search 三个已就绪技能，
把某个候选场所/话题的多源检索结果汇总为一份结构化 JSON，供上层角色做交叉核验。

本脚本只负责"取数据 + 汇总三态状态"，不做任何交叉核验/打分/排序判断——
那些判断留给调用本 skill 的 AI 角色在读取本脚本输出后按 SKILL.md 中的判据执行，
避免把主观推理写死在脚本里。
"""

import json
import os
import subprocess
import sys

SKILLS_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def run_baidu_search(query, recency_filter="year", site_filter=None):
    """调用 baidu-search 技能（本地宝/博客等通用网页检索）。"""
    script = os.path.join(SKILLS_DIR, "baidu-search", "scripts", "search.py")
    request_body = {
        "query": query,
        "search_recency_filter": recency_filter,
    }
    if site_filter:
        request_body["search_filter"] = {"match": {"site": site_filter}}
    try:
        proc = subprocess.run(
            ["python3", script, json.dumps(request_body, ensure_ascii=False)],
            capture_output=True, text=True, timeout=60,
        )
        stdout = proc.stdout.strip()
        if proc.returncode != 0 or stdout.startswith("Error"):
            return {"source": "baidu-search", "status": "unreachable", "reason": stdout or proc.stderr, "items": []}
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            return {"source": "baidu-search", "status": "unreachable", "reason": f"非预期输出：{stdout[:300]}", "items": []}
        if not data:
            return {"source": "baidu-search", "status": "empty", "reason": "本次检索无结果，不代表不可达", "items": []}
        items = [{
            "title": it.get("title", ""),
            "url": it.get("url", ""),
            "publish_time": it.get("page_time") or it.get("date"),
            "source": "baidu-search(本地宝/博客等)",
        } for it in data]
        return {"source": "baidu-search", "status": "ok", "reason": None, "items": items}
    except subprocess.TimeoutExpired:
        return {"source": "baidu-search", "status": "unreachable", "reason": "请求超时", "items": []}
    except Exception as e:
        return {"source": "baidu-search", "status": "unreachable", "reason": str(e), "items": []}


def run_tieba_search(keyword, recency_filter="year", top_k=20):
    """调用 tieba-search 技能（贴吧关键词内容检索）。"""
    script = os.path.join(SKILLS_DIR, "tieba-search", "scripts", "search.py")
    request_body = {"keyword": keyword, "search_recency_filter": recency_filter, "top_k": top_k}
    try:
        proc = subprocess.run(
            ["python3", script, json.dumps(request_body, ensure_ascii=False)],
            capture_output=True, text=True, timeout=60,
        )
        stdout = proc.stdout.strip()
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            return {"source": "tieba-search", "status": "unreachable", "reason": f"非预期输出：{stdout[:300]}", "items": []}
        return {
            "source": "tieba-search",
            "status": data.get("status", "unreachable"),
            "reason": data.get("reason"),
            "items": data.get("items", []),
        }
    except subprocess.TimeoutExpired:
        return {"source": "tieba-search", "status": "unreachable", "reason": "请求超时", "items": []}
    except Exception as e:
        return {"source": "tieba-search", "status": "unreachable", "reason": str(e), "items": []}


def run_xiaohongshu_search(keyword, notes=15, comments=20, sub_comments=10):
    """调用 xiaohongshu-market-research 技能（小红书笔记与评论检索）。
    该技能依赖登录态环境变量（XHS_COOKIE / XHS_COOKIE_FILE / XHS_BROWSER_URL / XHS_USER_DATA_DIR），
    缺失登录态时如实返回 unreachable，不编造小红书内容。
    """
    xhs_dir = os.path.join(SKILLS_DIR, "xiaohongshu-market-research")
    script = os.path.join(xhs_dir, "scripts", "run_research.sh")
    has_login = any(os.environ.get(k) for k in ("XHS_COOKIE", "XHS_COOKIE_FILE", "XHS_BROWSER_URL", "XHS_USER_DATA_DIR"))
    if not has_login:
        return {
            "source": "xiaohongshu-market-research", "status": "unreachable",
            "reason": "该源不可达：未检测到小红书登录态环境变量（XHS_COOKIE / XHS_COOKIE_FILE / "
                      "XHS_BROWSER_URL / XHS_USER_DATA_DIR 均未设置），需先完成登录态准备。",
            "items": [],
        }
    out_file = f"/tmp/xhs_{abs(hash(keyword))}.json"
    try:
        proc = subprocess.run(
            ["bash", script, keyword, str(notes), str(comments), str(sub_comments), out_file],
            capture_output=True, text=True, timeout=180, cwd=xhs_dir,
        )
        if proc.returncode != 0 or not os.path.exists(out_file):
            return {
                "source": "xiaohongshu-market-research", "status": "unreachable",
                "reason": f"抓取失败：{proc.stderr.strip()[:300] or proc.stdout.strip()[:300]}",
                "items": [],
            }
        with open(out_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
        notes_list = raw if isinstance(raw, list) else raw.get("notes", [])
        if not notes_list:
            return {"source": "xiaohongshu-market-research", "status": "empty", "reason": "本次检索无结果", "items": []}
        items = [{
            "title": n.get("title", ""),
            "url": n.get("url") or n.get("noteUrl", ""),
            "publish_time": n.get("publish_time") or n.get("time"),
            "source": "小红书",
        } for n in notes_list]
        return {"source": "xiaohongshu-market-research", "status": "ok", "reason": None, "items": items}
    except subprocess.TimeoutExpired:
        return {"source": "xiaohongshu-market-research", "status": "unreachable", "reason": "请求超时", "items": []}
    except Exception as e:
        return {"source": "xiaohongshu-market-research", "status": "unreachable", "reason": str(e), "items": []}
    finally:
        if os.path.exists(out_file):
            try:
                os.remove(out_file)
            except OSError:
                pass


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: collect_sources.py '<JSON: {\"keyword\": \"...\"}>'"}, ensure_ascii=False))
        sys.exit(1)
    try:
        params = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"JSON parse error: {e}"}, ensure_ascii=False))
        sys.exit(1)

    keyword = params.get("keyword")
    if not keyword:
        print(json.dumps({"error": "keyword 必填"}, ensure_ascii=False))
        sys.exit(1)

    recency_filter = params.get("search_recency_filter", "year")

    result = {
        "keyword": keyword,
        "sources": {
            "baidu_search": run_baidu_search(keyword, recency_filter),
            "tieba_search": run_tieba_search(keyword, recency_filter),
            "xiaohongshu_search": run_xiaohongshu_search(keyword),
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
