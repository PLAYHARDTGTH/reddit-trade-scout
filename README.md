# Reddit Trade Scout｜Reddit 外贸行业雷达

自动搜索、筛选和去重英文行业帖子，覆盖农业/工业机器人、铝锌合金五金、汽车销售及二手车进出口。扫描过程不调用 AI，因此不消耗模型 token。

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

扫描会打开一个专用 Playwright 窗口，并在整个扫描过程中复用同一个页面，不再为每个搜索词反复开关页面。Codex 从短名单中分析帖子并给出建议；用户确认后，Codex 才接管你当前已登录的普通 Chrome Reddit 标签页进行点赞或评论，再记录结果：

```bash
npm run mark -- 1 upvote
npm run mark -- 2 comment "comment permalink"
npm run mark -- 3 skip
```

已处理帖子保存在本机自动创建的 `history.json`，后续扫描会自动排除；该文件不会上传到 GitHub。完整候选页面是 `output/candidates.html`；搜索词在 `config.json` 中修改。

扫描、登录和 Codegen 不要同时运行；它们共用同一个本地浏览器配置目录。

## 页面改版时

```bash
npm run codegen
```

Codegen 只用于观察并重新生成定位器；不要直接把录制结果当长期脚本，也不要录制密码、点赞或评论。
