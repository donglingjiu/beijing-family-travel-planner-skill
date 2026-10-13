import sys
import json
import os
import requests


def tieba_site_search(api_key, keyword, recency_filter=None, top_k=20):
    """通过百度AI搜索API，限定 site:tieba.baidu.com，检索贴吧关键词内容。

    复用 baidu-search 已验证的 BDSE 接口，只是加上 site 过滤，
    不引入新的外部依赖或访问路径。
    """
    url = "https://qianfan.baidubce.com/v2/ai_search/web_search"
    headers = {
        "Authorization": "Bearer %s" % api_key,
        "X-Appbuilder-From": "openclaw",
        "Content-Type": "application/json",
    }
    request_body = {
        "messages": [{"content": keyword, "role": "user"}],
        "edition": "standard",
        "search_source": "baidu_search_v2",
        "resource_type_filter": [{"type": "web", "top_k": top_k}],
        "search_filter": {"match": {"site": ["tieba.baidu.com"]}},
        "search_recency_filter": recency_filter or "year",
        "safe_search": False,
    }
    response = requests.post(url, json=request_body, headers=headers, timeout=30)
    response.raise_for_status()
    results = response.json()
    if "code" in results:
        raise Exception(results["message"])
    return results.get("references", [])


def normalize_items(raw_items):
    """把原始搜索结果整理为携带可追溯信息（标题、时间、URL、摘要）的条目列表。"""
    normalized = []
    for item in raw_items:
        normalized.append({
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "publish_time": item.get("page_time") or item.get("date") or None,
            "snippet": item.get("snippet") or item.get("content") or "",
            "source": "tieba.baidu.com",
        })
    return normalized


def build_result(status, keyword, items=None, reason=None):
    return {
        "status": status,  # "ok" | "unreachable" | "empty"
        "source": "tieba.baidu.com",
        "keyword": keyword,
        "items": items or [],
        "reason": reason,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps(build_result(
            "unreachable", "", reason="Usage: python search.py '<JSON>'"
        ), ensure_ascii=False))
        sys.exit(1)

    try:
        parse_data = json.loads(sys.argv[1])
    except json.JSONDecodeError as e:
        print(json.dumps(build_result(
            "unreachable", "", reason=f"JSON parse error: {e}"
        ), ensure_ascii=False))
        sys.exit(1)

    keyword = parse_data.get("keyword")
    if not keyword:
        print(json.dumps(build_result(
            "unreachable", "", reason="Error: keyword must be present in request body."
        ), ensure_ascii=False))
        sys.exit(1)

    recency_filter = parse_data.get("search_recency_filter", "year")
    top_k = parse_data.get("top_k", 20)

    api_key = os.getenv("BAIDU_API_KEY")
    if not api_key:
        print(json.dumps(build_result(
            "unreachable", keyword,
            reason="Error: BAIDU_API_KEY must be set in environment. 该源不可达：缺少检索凭证。",
        ), ensure_ascii=False))
        sys.exit(1)

    try:
        raw_items = tieba_site_search(api_key, keyword, recency_filter, top_k)
    except requests.exceptions.RequestException as e:
        print(json.dumps(build_result(
            "unreachable", keyword,
            reason=f"该源不可达：网络请求失败（{str(e)}）。请在数据来源说明中标注贴吧不可达，并使用其余来源补齐。",
        ), ensure_ascii=False))
        sys.exit(0)
    except Exception as e:
        print(json.dumps(build_result(
            "unreachable", keyword,
            reason=f"该源不可达：{str(e)}。请在数据来源说明中标注贴吧不可达，并使用其余来源补齐。",
        ), ensure_ascii=False))
        sys.exit(0)

    items = normalize_items(raw_items)
    if not items:
        print(json.dumps(build_result(
            "empty", keyword,
            reason="本次检索未返回贴吧结果（可能是关键词过窄或站点确实无相关讨论），不代表不可达。",
        ), ensure_ascii=False))
        sys.exit(0)

    print(json.dumps(build_result("ok", keyword, items=items), ensure_ascii=False, indent=2))
