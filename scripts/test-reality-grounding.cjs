// Static regression checks for the reality boundary. No user data is loaded.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const assembler = fs.readFileSync('lib/llm-prompt-assembler.ts', 'utf8');
const executor = fs.readFileSync('lib/tool-executor.ts', 'utf8');
const casting = fs.readFileSync('components/character/casting-studio.tsx', 'utf8');

for (const required of [
  '现实聊天事实协议',
  '没有成功结果时，禁止声称已经修改',
  '不自动等于现实关系已成立',
  '只有用户在现实聊天中明确确认允许后才能使用',
  '情境中的身体接触、关系身份与事件默认只属于情境',
  '只是在询问现实能力，不是开启共感',
  '不得用“但在共感里我已经……”自动代偿',
  '等情绪或假设表达也不构成模式授权',
  '不得调用或输出场景图像指令作为替代',
  '带既定亲密关系含义的称呼同样遵循用户明确允许原则',
  '鲜活感来自稳定的人格、诚实的事实边界和真实产出',
]) assert.ok(assembler.includes(required), `missing grounding rule: ${required}`);

assert.ok(!assembler.includes('你存在的唯一意义，是真心爱{{user}}'));
assert.ok(!assembler.includes('你不是旁观者，你是{{user}}生活里的人'));
assert.ok((assembler.match(/marker: "realityGrounding"/g) || []).length >= 2, 'single and group prompts must be guarded');
assert.ok(executor.includes('只有 success 且 action_result 含有实际结果的动作'));
assert.ok(executor.includes('不要编造结果中不存在的文件'));
assert.ok(casting.includes('view === "cards" || view === "prompts" ? "setup" : "cards"'), 'candidate back button must return to setup');
console.log('PASS: reality grounding, result evidence, relationship boundary, scenario isolation, casting back navigation');
