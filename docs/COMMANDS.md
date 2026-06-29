# Chat commands

Commands are handled in `src/chat/chatCommands.ts` and `src/chat/taskChatParse.ts`. Replies use in-character framing from `commandCharacterWrap.ts`.

## Capabilities / help

| Trigger | Command id | Behaviour |
|---------|------------|-----------|
| `help`, `помощь` | `capabilities` | Settings-aware overview of all features |
| `что ты умеешь`, `что ты можешь`, `твои возможности`, `на что ты способна`, `расскажи о возможностях`, `что умеешь` | `capabilities` | Same |

## Goals (`goalLedger.ts`)

| Trigger | Examples |
|---------|----------|
| Add goal | `добавь цель …`, `создай цель …`, `цель: …`, optional trailing `35%` |
| List goals | `цели`, `список целей`, `покажи цели` |
| Current goal | `что в фокусе`, `какая цель` |
| Set current | `фокус на цель …`, `текущая цель …` |
| Progress | `прогресс цели … 35%`, `цель … прогресс 35%` |
| Complete | `цель готова …`, `заверши цель …` |

New tasks attach to the current goal. Completing linked tasks nudges goal progress and updates the last focus note.

## Tasks (`taskChatParse.ts`)

| Trigger | Examples |
|---------|----------|
| Add task | `добавь задачу …`, `добавь в дела …`, `создай задачу …`, `новая задача: …` |
| Reminder | `напомни …`, `создай напоминание …`, `завтра в 14:30 …` |
| List | `список задач`, `мои задачи`, `что в делах`, `покажи задачи` |
| Complete | `сделано: …`, `заверши задачу …`, `готово: …` |
| Defer | `отложи …`, `отложи … на час`, `перенеси … на завтра` |
| Next | `что next`, `что дальше` |

High-confidence `task_command` intent without explicit verb also adds a task.

## Project binder

| Trigger | Behaviour |
|---------|-----------|
| `запомни это как текущий проект <path>` | Bind project folder |
| `прикрепи readme` | Pin README from project root |
| `покажи последние изменённые файлы` | List recent project files |

## Focus session

| Trigger | Behaviour |
|---------|-----------|
| `старт фокуса: <goal>`, `начни фокус: …` | Start focus session |
| `стоп фокус`, `завершить фокус` | End focus |
| `фокус: шаг …`, `шаг фокуса …` | Update current step |
| `фокус: задача …`, `добавь задачу фокуса …` | Add focus subtask |
| `блокер: …`, `фокус: блокер …` | Add blocker |
| `блокеры фокуса: …` | Replace blocker list |
| `сравни цель с todo` | Goal vs open focus tasks |

## Backlog (legacy phrasing, maps to tasks)

| Trigger | Behaviour |
|---------|-----------|
| `запиши в backlog …` | Add backlog item |
| `что next`, `что дальше` | Next backlog item |
| `по privacy` | Open privacy-category items |
| `отложи …` | Defer first/open match |

## Git (read-only, active project)

| Trigger | Behaviour |
|---------|-----------|
| `git status`, `статус git` | Branch, changed, untracked, staged |
| `git log`, `последние коммиты` | Recent commits |
| `git diff [path]` | File or repo diff |

Write verbs (`commit`, `push`, etc.) are rejected.

## Reviews and planning

| Trigger | Behaviour |
|---------|-----------|
| `daily review`, `дневной обзор` | Daily review (LLM if online) |
| `weekly review`, `недельный обзор` | Weekly review |
| `сделай план тестирования для модуля …` | Test plan → backlog |

## Notes

- Commands do not consume LLM unless noted (reviews, test plan with settings).
- Task commands update the inline **Дела** board when chat is closed.
- Full static reference also in repo: `docs/FEATURES.md`, `docs/ML.md`.
