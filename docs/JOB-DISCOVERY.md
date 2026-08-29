# 通用岗位发现

## 目标

系统通过两条路径发现岗位，并在调用大模型之前完成尽可能多的零 Token 工作：

1. `company`：从 `data/kdocs-full.json` 筛选目标公司，再生成官网引用、Boss 采集任务和 LinkedIn 手动搜索链接。
2. `platform`：根据当前用户的能力画像和求职意愿，直接生成 Boss 采集任务和 LinkedIn 手动搜索链接。

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

`--limit` 限制 KDocs 公司数；`--task-limit` 只限制 AutoCLI 网络任务数，官网与 LinkedIn 手动引用不占额度。`all` 路径会在公司路径和平台路径之间轮流分配额度，避免单一路径占满。

公司路径只为该公司当前 KDocs 记录中匹配的岗位和地点创建搜索任务；没有匹配时才使用少量回退搜索词。

## AutoCLI 实际采集

将 AutoCLI 放在 `.local/bin/autocli`，或通过 `--autocli` 指定路径：

```bash
npm run jobs:platform -- --task-limit 1 --result-limit 5
```

只有 Boss 会通过 AutoCLI 读取 Chrome 登录态。单个 Boss 任务失败只会进入 `errors`，不会阻断其他任务。

仓库不自动抓取 LinkedIn，以遵守其平台规则。启用 LinkedIn 后只生成标准化的手动搜索链接，可复制到网络可达的设备打开。

## 案例隔离

`examples/china-ai-tob-sales/` 保存原有筛选条件和旧脚本，只用于演示。系统层不得导入该目录。
