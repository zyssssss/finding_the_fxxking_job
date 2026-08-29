# 通用岗位发现

## 目标

系统通过两条路径发现岗位，并在调用大模型之前完成尽可能多的零 Token 工作：

1. `company`：从 `data/kdocs-full.json` 筛选目标公司，再生成官网、Boss、LinkedIn 发现任务。
2. `platform`：根据当前用户的能力画像和求职意愿，直接生成 Boss、LinkedIn 搜索任务。

两条路径最终使用相同的岗位格式。示例配置不会被运行时自动加载。

## 初始化

公共用户应先创建中性配置：

```bash
npm install
npm run jobs:init
```

然后编辑：

- `config/capability-profile.yml`：从 CV 得到的可胜任岗位。
- `config/job-intent.yml`：用户主动选择的岗位、地点、行业和来源。

如需体验仓库中的公开案例，必须显式选择：

```bash
npm run jobs:init -- --example china-ai-tob-sales
```

初始化命令不会覆盖已有用户配置。

## 零 Token 试运行

```bash
npm run jobs:company -- --limit 5 --dry-run
npm run jobs:platform -- --task-limit 5 --dry-run
npm run jobs:all -- --limit 5 --task-limit 10 --dry-run
```

`--limit` 限制 KDocs 公司数；`--task-limit` 限制最终网络任务数，避免组合爆炸。

公司路径只为该公司当前 KDocs 记录中匹配的岗位和地点创建搜索任务；没有匹配时才使用少量回退搜索词。

## AutoCLI 实际采集

将 AutoCLI 放在 `.local/bin/autocli`，或通过 `--autocli` 指定路径：

```bash
npm run jobs:platform -- --task-limit 1 --result-limit 5
```

Boss 和 LinkedIn 都依赖 Chrome 扩展与有效登录状态。单个来源或任务失败只会进入 `errors`，不会阻断其他任务。

无 VPN 的国内电脑以 Boss 为主。LinkedIn 可在网络可达的设备运行同一接口，再把标准化结果导入后续流程。

## 案例隔离

`examples/china-ai-tob-sales/` 保存原有筛选条件和旧脚本，只用于演示。系统层不得导入该目录。
