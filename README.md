# beijing-family-travel-planner 交付包

## 包含内容

本 zip 包含 **1 个目标 skill + 3 个其运行时直接依赖的检索 skill**，均原样从 CMPAAAA-27 的构建产物中拷贝，未做任何修改：

```
skills/
├── beijing-family-travel-planner/   # 目标 skill：北京周末带娃亲子游性价比攻略生成器
│   ├── SKILL.md
│   ├── references/judgment_criteria.md   # 核心判据：交叉核验/五维打分/区域过滤/错峰建议/五段式输出
│   └── scripts/collect_sources.py        # 编排调用下面三个依赖 skill 取数的脚本
├── baidu-search/                    # 依赖：本地宝/博客等通用网页检索
├── tieba-search/                    # 依赖：百度贴吧关键词检索
└── xiaohongshu-market-research/     # 依赖：小红书笔记/评论检索
```

## 为什么把 3 个依赖 skill 一起打包

`beijing-family-travel-planner/scripts/collect_sources.py` 用相对路径直接 `subprocess` 调用同级目录下的
`baidu-search/scripts/search.py`、`tieba-search/scripts/search.py`、`xiaohongshu-market-research/scripts/run_research.sh`。
如果只打包目标 skill 本身，脚本运行时会因找不到这三个依赖目录而直接失败——用户拿到的会是一个无法运行的空壳。
因此按判断，将这三个依赖 skill 一并纳入同一个 zip，且必须保持本 zip 内的相对目录结构（四个 skill 平级放在 `skills/` 下）不变。

这三个依赖 skill 已在 CMPAAAA-24 的专家团交付包中存在；本次打包的副本与 CMPAAAA-24 相互独立，互不影响，未改动 CMPAAAA-24 已交付的附件。

## 如何导入使用

1. 解压本 zip，得到 `skills/` 目录（含 4 个子目录）。
2. 将整个 `skills/` 目录下的 4 个子目录，原样放入你的 Paperclip 专家团包（或任意支持 Claude Skills 规范的 agent 运行环境）的 skills 目录下，保持四者平级、路径不变。
3. 配置检索凭证（否则对应源会如实返回 `unreachable`，不影响整体流程，但会缺少该源数据）：
   - `baidu-search` / `tieba-search` 需要环境变量 `BAIDU_API_KEY`（百度千帆 AI 搜索凭证）。
   - `xiaohongshu-market-research` 需要登录态环境变量之一：`XHS_COOKIE` / `XHS_COOKIE_FILE` / `XHS_BROWSER_URL` / `XHS_USER_DATA_DIR`。
4. 在 agent 对话中提出诉求，例如"周末带娃去哪""朝阳区附近好去处"，agent 识别后会自动加载 `beijing-family-travel-planner`，按其 `SKILL.md` 中的步骤读取判据、调用 `collect_sources.py` 取数、完成交叉核验与打分，输出五段式攻略（需求确认/性价比对比表/路线图/错峰建议/数据来源说明）。

## 版本溯源

本包内容原样来自 CMPAAAA-27 构建产物路径：
`.agent-team-builder/runs/CMPAAAA-27/build-8c7d162b9b494b27b9e45d1ecf0f4935/skills/`
仅移除了 `beijing-family-travel-planner/.baidu-cc/meta.json`（该文件是构建会话本地元数据，记录的是构建时的 session_id/transcript_path/本机 cwd，与 skill 功能无关，且包含构建环境的本地路径信息，不应作为 skill 内容分发）。除此之外未新增、未改写、未删减任何判据或脚本内容。
