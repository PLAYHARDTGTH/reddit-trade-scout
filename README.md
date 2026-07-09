# Reddit Trade Scout｜Reddit 外贸行业雷达

自动搜索、筛选和去重英文帖子，覆盖农业/工业机器人、铝锌合金五金、汽车销售及二手车进出口，也会从全站搜索经济、金融和搞笑视频热门内容。扫描过程不调用 AI，因此不消耗模型 token。

## 首次使用

```bash
npm install
npm run login
```

浏览器打开后手动登录 Reddit，再回到终端按回车。登录状态只保存在本机 `.reddit-profile/`。

## 日常使用

```bash
npm run scan
npm run shortlist
```

扫描会打开一个专用 Playwright 窗口，并在整个扫描过程中复用同一个页面，不再为每个搜索词反复开关页面。每天首次扫描会从 `config.json` 的区间中抽取一次目标数量，默认点赞 3–5、评论 1–3；同一天重跑沿用 `output/daily-plan.json`，不会重复抽取。

扫描默认读取最近一周的热门结果，还会生成 `output/brief.json`，只保存前若干候选的有限正文，以及前三条评论的正文、票数和永久链接，供 Codex 分析。热门帖子和评论都可作为点赞候选；经用户确认后，才接管当前已登录的普通 Chrome Reddit 标签页执行，再记录结果：

```bash
npm run mark -- 1 upvote
npm run mark -- 2 comment "comment permalink"
npm run mark -- 3 skip
```

已处理帖子保存在本机自动创建的 `history.json`，后续扫描会自动排除；该文件不会上传到 GitHub。完整候选页面是 `output/candidates.html`；精简摘要、每日目标和搜索词分别保存在 `output/brief.json`、`output/daily-plan.json` 和 `config.json`。

扫描、登录和 Codegen 不要同时运行；它们共用同一个本地浏览器配置目录。

## Codex Skill

配套 Skill 已备份在 `skills/run-reddit-opencli-workflow/`。它不是独立项目，和脚本放在同一仓库，方便 clone 后同时拿到运行规则和代码。

如需安装到本机 Codex：

```bash
mkdir -p ~/.codex/skills
cp -R skills/run-reddit-opencli-workflow ~/.codex/skills/
```

安装后重启 Codex，再用自然语言说“执行完整流程”即可。实际执行仍需要本机已配置 OpenCLI、Chrome Browser Bridge，并且 Reddit 账号已登录。

## 更新记录

### 2026-07-09

- 备份 `run-reddit-opencli-workflow` Codex Skill 到仓库，放在 `skills/run-reddit-opencli-workflow/`。
- README 增加 Skill 安装说明，clone 后可把该目录复制到 `~/.codex/skills/` 使用。

### 2026-07-06

- 增加全站经济、金融和搞笑视频热门搜索，不再只依赖固定行业板块。
- 候选改为最近一周热门排序，相关词最低命中数改为 1。
- 精简摘要增加前三条评论的票数和永久链接，帖子或评论均可作为点赞候选。

### 2026-07-03

- 新增每日随机目标：点赞 3–5、评论 1–3；同一天重复扫描沿用同一目标。
- 新增 `output/brief.json`，正文最多保留 1200 字符，每帖最多保留 3 条、每条 350 字符的评论，用于减少模型上下文。
- 保留人工确认：脚本只扫描和生成建议，点赞及评论仍在用户确认后执行。
- 已通过自检和一次真实只读扫描：7 条候选、6 条精简摘要、0 个搜索失败、0 个摘要提取失败。

## 页面改版时

```bash
npm run codegen
```

Codegen 只用于观察并重新生成定位器；不要直接把录制结果当长期脚本，也不要录制密码、点赞或评论。
