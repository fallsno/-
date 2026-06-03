---
name: 'session-archivist'
description: 'Appends lightweight conversation decisions and syncs archive files. Invoke at the start of every user message and after each substantive assistant reply in this workspace.'
---

# Session Archivist

## Purpose

Maintain a lightweight, decision-oriented archive for this workspace under the root directory `历史会话归档/`.

This workspace version overrides the heavy metadata model and uses a minimal
4-field structure per turn:

- `我的问答`
- `AI 给出的方案`
- `我选择的执行方案`
- `接下来应该执行的方案`

## When To Invoke

Invoke this skill in both cases:

1. Immediately after receiving a new user message.
2. Immediately after producing any substantive assistant reply.

Do not wait until the whole conversation ends.

## Core Rules

- 根据日期创建文件夹，例如 `历史会话归档/YYYY-MM-DD/`。
- 每日会话记录，根据不同任务创建不同文件归集，例如 `历史会话归档/YYYY-MM-DD/任务名称.md`。
- Use `一任务一文件 + 每轮追加`.
- Do not write heavy metadata such as `status`, `turn_count`, `summary`,
  `keywords`, or timestamps inside the正文.
- Prefer concise decision summaries over full transcript copies.

## Active Session Pointer

Use `历史会话归档/.current-session` as the active session pointer.

Resolution order:

1. If the user explicitly provides a session file path, use that file.
2. Else if IDE context already points to an archive session file, continue that file.
3. Else if `历史会话归档/.current-session` exists, use the path inside it.
4. Else create a new session file for the current date and task, and write its path into `历史会话归档/.current-session`.

Whenever a new session file is created or the target session changes, update the
pointer file immediately.

## Session File Format

Each session file should follow the workspace template and contain:

- `## 任务主题`
- `## 第 N 轮`
- In each round:
  - `我的问答`
  - `AI 给出的方案`
  - `我选择的执行方案`
  - `接下来应该执行的方案`

## Update Workflow

### On New User Message

1. Resolve the active session file using the pointer rules above.
2. If the current round does not exist yet, append a new `## 第 N 轮`.
3. Fill `我的问答`.
4. If no decision is made yet:
   - set `我选择的执行方案` to `待确认`
   - set `接下来应该执行的方案` to `待补充`

### After Assistant Reply

1. Re-open the same active session file.
2. Update the current round:
   - fill `AI 给出的方案`
   - fill `我选择的执行方案`
   - fill `接下来应该执行的方案`

## Creation Rule

When creating a new session file:

- path: `历史会话归档/YYYY-MM-DD/<任务名称>.md`
- title: 任务主题

If the exact task name is not clear, ask the user or generate a stable, human-readable filename based on the task topic.

## Strict Constraints

- Never overwrite or delete existing rounds.
- Never create multiple files for the same ongoing task on the same day unless the user explicitly asks to split it.
- Never copy the assistant's full long answer into the archive unless the user explicitly asks for full transcript preservation.
- If the user has not chosen a plan yet, write `待确认`.
- If the next step is still unclear, write `待补充`.

## Expected Outcome

Every conversation in this workspace should become a compact, continuously updated
decision record that can be resumed quickly by later AI turns, perfectly organized by date and task.
