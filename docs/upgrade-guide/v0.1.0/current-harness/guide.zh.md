---
kind: upgrade-guide
description: DSPy 的配置、命令参数、历史记录和角色应用需要明确指定当前 Harness 设置。
---

# 将 dsh-dspy 升级到当前 Harness

## 变更

插件面向 Harness 0.2.0-rc.2 和 Cordis 4.0.4。不支持隐式无密钥回退、虚构分数、完整角色替换、自动会话挖掘、`feedback` 指标和未生效的 `requireApproval` 设置。严格配置校验会拒绝过时字段。`/dspy evolve` 接收 JSON 参数。远程方法返回真实的 Harness `RemoteResult`，而不是虚构的封装字段。

## 迁移

1. 使用 `pnpm install --ignore-scripts` 和 `pnpm build`，基于真实本地 Harness 开发依赖构建此项目；使用 `pnpm setup:python` 显式安装 DSPy。通过目标 Desktop 实例的插件页面激活此插件包。
2. 从插件配置中删除 `requireApproval`。将 `metric: feedback` 替换为 `exact_match` 或 `contains`，并显式提供带标签样本。无密钥改写请选择 `mode: heuristic`；其指标为 null，表示未评估。
3. 提供指令，或选择要读取的现有片段。应用前，在当前会话中明确选择 `targetSection: personaPrefix` 或 `personaSuffix`。不能用完整提示词替换作为替代。`dryRun: true` 禁止应用。编译产生的示例仅返回，不应用。
4. 如果配置的历史文件含有旧版合成结果，请单独保留该文件，并使用新的 `dataDir`；旧结果不能作为当前实测记录读取。保存的历史不会在恢复会话时重新应用指令。
5. 用 `/dspy evolve {"instruction":"Answer clearly.","options":{"mode":"heuristic","dryRun":true},"trainset":[]}` 替换旧命令参数。自定义远程调用方必须挂载插件描述符并读取 `RemoteResult`。
6. 确认 DSPy 页签出现、仅优化操作返回 `applied: false`、启发式指标为 null，以及所选片段的应用只改变当前智能体下次记录的 `system/message`。运行 `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `node scripts/smoke-built.mjs` 验证本地集成。
