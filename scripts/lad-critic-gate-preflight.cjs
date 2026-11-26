#!/usr/bin/env node
/**
 * Подсказка gate по изменённым файлам (staged + unstaged).
 * node scripts/lad-critic-gate-preflight.cjs
 */
const { execSync } = require('node:child_process');

const root = process.cwd();
function gitLines(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const files = [...new Set([...gitLines('diff --name-only'), ...gitLines('diff --name-only --cached')])];
const gates = new Set();
const tags = new Set();
let serious = false;

const rules = [
  {
    tag: 'ui-viewports',
    match: (f) => /src\/styles\.css$|App\.tsx$|\.css$/.test(f) && !f.includes('notes.css'),
    gates: [
      'npm run build',
      'QA_URL=http://127.0.0.1:4173/ node artifacts/final-audit-2026-11-25/measure-viewport-layout.mjs',
      'QA_URL=http://127.0.0.1:4173/ node scripts/qa-desktop-layout.cjs',
      'QA_URL=http://127.0.0.1:4173/ node scripts/qa-desktop-surfaces.cjs',
    ],
  },
  {
    tag: 'schedule-data',
    match: (f) => /scheduleApi|data\/|study-period|lesson-selection/i.test(f),
    gates: ['pnpm test (или npm test)', 'node scripts/qa-study-periods.cjs', 'node scripts/qa-lesson-selection.cjs'],
  },
  {
    tag: 'service-worker',
    match: (f) => /public\/sw\.js$/.test(f),
    gates: ['node --check public/sw.js', 'offline reload smoke (см. AGENTS.md)'],
  },
  {
    tag: 'qa-scripts',
    match: (f) => /^scripts\/qa-/.test(f) || f.includes('measure-viewport-layout'),
    gates: ['прогнать изменённый сценарий на preview'],
  },
  {
    tag: 'audit-docs',
    match: (f) => /artifacts\/final-audit|PRE-PROD-RELEASE-GATE/.test(f),
    gates: ['сверка SHA/CI/чисел с фактом', 'skill anti-ai-slop для сдачи'],
  },
];

for (const file of files) {
  for (const rule of rules) {
    if (rule.match(file)) {
      serious = true;
      tags.add(rule.tag);
      rule.gates.forEach((g) => gates.add(g));
    }
  }
}

const prodNote = tags.has('ui-viewports')
  ? 'После deploy: QA_URL=https://germanpolkin.ru/lad-vlsu/ — measure + qa-desktop-*'
  : null;

console.log(
  JSON.stringify(
    {
      serious,
      filesChanged: files.length,
      files: files.slice(0, 40),
      tags: [...tags],
      recommendedGates: [...gates],
      prodNote,
      criticCreatorSkill: '.cursor/skills/lad-critic-creator/SKILL.md',
    },
    null,
    2,
  ),
);

process.exit(0);