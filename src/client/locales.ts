/** Typed product copy for the DSPy control panel. */
export const NS = 'dspy'
export const en = {
  title: 'DSPy', instruction: 'Instruction (empty reads the selected fragment)',
  examples: 'Training examples (JSON)', strategy: 'Strategy', mode: 'Mode',
  target: 'Application target', none: 'Select a target before applying', prefix: 'Persona prefix', suffix: 'Persona suffix',
  dryRun: 'Dry run', apply: 'Evolve and apply', autoApply: 'Auto-apply',
  history: 'History', empty: 'No runs yet', trainset: 'Latest training examples',
  completed: 'Operation completed',
  loading: 'Loading DSPy',
  unmeasured: 'Unmeasured heuristic', measured: 'Training-set score',
  applied: 'Applied to {target} in session {session}', notApplied: 'Not applied',
  failure: 'The operation failed', retry: 'Retry', limitation: 'Select a prefix or suffix explicitly. This does not replace the whole system prompt. Changes affect the next prompt assembly and last only while this plugin and agent remain loaded.',
  heuristic: 'Heuristic (no model calls)', dspy: 'DSPy (requires a credential and labeled examples)',
  metric: 'Metric', exact: 'Exact match', contains: 'Contains reference',
  gepa: 'GEPA', miprov2: 'MIPROv2', bootstrapFewShot: 'BootstrapFewShot',
} as const
export type DspyKey = keyof typeof en
export const zh: Record<DspyKey, string> = {
  title: 'DSPy', instruction: '指令（留空读取所选片段）',
  examples: '训练样本（JSON）', strategy: '优化器', mode: '模式',
  target: '应用目标', none: '应用前请选择目标', prefix: '角色前缀', suffix: '角色后缀',
  dryRun: '仅优化', apply: '优化并应用', autoApply: '自动应用',
  history: '历史记录', empty: '暂无记录', trainset: '最近训练样本数',
  completed: '操作已完成',
  loading: '正在加载 DSPy',
  unmeasured: '未评估的启发式改写', measured: '训练集分数',
  applied: '已应用到会话 {session} 的 {target}', notApplied: '未应用',
  failure: '操作失败', retry: '重试', limitation: '请明确选择前缀或后缀。此操作不替换完整系统提示词。更改在下次提示词组装时生效，仅在此插件和智能体保持加载期间有效',
  heuristic: '启发式（不调用模型）', dspy: 'DSPy（需要凭据和带标签样本）',
  metric: '评估指标', exact: '精确匹配', contains: '包含参考答案',
  gepa: 'GEPA', miprov2: 'MIPROv2', bootstrapFewShot: 'BootstrapFewShot',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { dspy: DspyKey }
}
