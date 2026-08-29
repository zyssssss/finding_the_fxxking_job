# 通用低 Token 岗位发现规范

## 需求

1. 支持两条发现路径：
   - 从 `data/kdocs-full.json` 的公司记录筛选目标公司，再生成官网、Boss、LinkedIn任务。
   - 根据当前用户的能力画像与求职意愿，直接生成 Boss、LinkedIn搜索任务。
2. 两条路径使用同一份用户配置与统一岗位格式。
3. 发现、过滤、去重和任务规划不调用大模型。
4. 用户筛选条件不得硬编码在公共运行逻辑中。
5. 原有“中国 AI ToB 销售”条件仅作为显式选择的公开案例。
6. 缺少用户配置时拒绝运行，不得自动回退到案例。
7. Boss 或 LinkedIn 单个任务失败不得中断其他任务。
8. 支持限制公司数、网络任务数和单次结果数。
9. 无 VPN 环境以 Boss 为主；LinkedIn 保持可选且默认关闭。
10. 本地完成一次 KDocs 零 Token 试运行和一次 Boss 只读连接试运行。

## 外部接口

```bash
node src/cli/jobs.mjs init [--example <name>]
node src/cli/jobs.mjs collect --route company|platform|all [--dry-run]
```

公共用户的中性初始化不得包含任何具体地点、岗位或行业偏好。
