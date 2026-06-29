# Ari guided tour

This guide is a practical first-session route for a person who has never used Ari. It is not a full reference; use it to meet the main features in a natural order.

Estimated time: 30-45 minutes.

## 0. Start Ari

1. Launch the app:

```powershell
npm run tauri dev
```

2. Finish onboarding if it appears.
3. Pick a provider:
   - Ollama for local chat.
   - GigaChat API for cloud chat/vision/embeddings.
4. Open Settings and confirm:
   - Chat provider works.
   - Proactive messages are enabled if you want Ari to speak first.
   - Activity tracking is enabled only if you want advisor features.

Quick sanity check in chat:

```text
Привет, Ari. Объясни в двух фразах, что ты умеешь.
```

Expected: Ari answers in character, not as a corporate assistant.

## 1. Learn The Chat

Try ordinary non-work conversation first:

```text
Давай просто поговорим про музыку.
```

```text
Я залип в игру и не хочу сейчас про задачи.
```

Expected: Ari can talk casually and does not force the conversation back to productivity.

Then ask for the built-in capability overview:

```text
что ты умеешь
```

Also try:

```text
help
```

Expected: Ari lists features according to current settings.

## 2. Try Tasks

Create a task:

```text
добавь задачу проверить Ari tour
```

List tasks:

```text
список задач
```

Close the chat panel. The task board should appear near Ari.

Complete the task from chat:

```text
готово: проверить Ari tour
```

Expected:

- Task appears in the board/list.
- Done/snooze/next controls work.
- Ari does not claim a task was created unless the command was actually handled.

## 3. Try Goals

Create a goal:

```text
добавь цель Познакомиться с Ari 10%
```

Check focus:

```text
что в фокусе
```

Add a task under the current goal:

```text
добавь задачу пройти guided tour
```

Complete it:

```text
готово: пройти guided tour
```

Expected:

- The task attaches to the active goal.
- Completing it nudges goal progress.
- The goal remains visible in the task/focus board.

## 4. Try Goal Inference

This checks that completed tasks can move the right goal even if another goal is current.

```text
добавь цель Рабочий проект 0%
```

```text
добавь цель Отчёт недели 0%
```

```text
фокус на цель Рабочий проект
```

```text
добавь задачу собрать итоги недели
```

```text
готово: собрать итоги недели
```

Expected: Ari should assign progress to `Отчёт недели`, not blindly to the current `Рабочий проект`, if the provider can infer the better goal. If the model is offline, local scoring is used as fallback.

## 5. Try Focus And Pomodoro

Start a focus session:

```text
старт фокуса: проверить основные функции Ari
```

Add a step:

```text
фокус: шаг проверить задачи и цели
```

Add a blocker:

```text
блокер: непонятно, где настройки proactive
```

Close chat and use the focus/pomodoro controls on the board.

Finish:

```text
стоп фокус
```

Expected:

- Current goal, step, blockers, and pomodoro state appear in the board.
- Ari keeps focus context in replies.
- Ending focus gives a recap or gracefully skips it if the model is unavailable.

## 6. Try Proactive Ari

In Settings:

- Proactive messages: on.
- Programmer advisor: on.
- Activity tracking: on.
- Quiet mode: off.
- Initiative level: active.
- Interval: 1 min for testing.

Close chat and keep Ari visible. Work in an IDE or browser for 1-2 minutes.

For task/activity linking:

```text
добавь задачу проверить Tauri active window permissions
```

Then search or work on something named:

```text
Tauri active window permissions
```

Expected:

- Ari starts a relevant conversation or ambient bubble without a click.
- If activity clearly matches a task, she uses that task as context.
- If the relation is unclear, she asks whether the activity is connected.
- She does not claim she sees the screen unless a vision action was used.

## 7. Try Activity Diagnostics

Open Settings -> Diagnostics.

Generate a few signals:

1. Copy a code snippet.
2. Copy a stack trace.
3. Stay in one IDE file for a few minutes.
4. Search a browser topic related to work.

Expected:

- Clipboard/file/query/error signals appear.
- Secrets are redacted.
- Advisor topics use recent signals instead of stale random tabs.

## 8. Try Vision

Enable a vision provider in Settings.

1. Open a visible window with readable content.
2. Click the eye button.
3. Try overview mode.
4. Try OCR mode.
5. Try region select.
6. Try compare mode: take one shot, change something, take a second shot.

Expected:

- Ari hides before capture.
- The image is not kept after processing.
- Ari describes only what is visible in the shot.
- She does not pretend to have continuous screen access.

## 9. Try Memory

Tell Ari a harmless personal preference:

```text
Запомни: я люблю короткие технические объяснения без воды.
```

Ask later:

```text
Что ты помнишь о моём стиле объяснений?
```

Open the memory panel if available and inspect saved facts/inbox.

Expected:

- Stable facts can be saved.
- Low-confidence items may appear in inbox.
- Ari uses memory naturally and does not invent memories.

## 10. Try Teach Ari

Open Teach Ari mode and add a behavior rule, for example:

```text
не называй меня пользователь
```

Send a normal message after that.

Expected:

- The rule is stored.
- Ari follows it in later replies.
- The rule does not override privacy or safety boundaries.

## 11. Try Project Binder And Read-Only Git

Bind a project folder:

```text
запомни это как текущий проект <PROJECT_ROOT>
```

Pin README:

```text
прикрепи readme
```

Ask:

```text
покажи последние изменённые файлы
```

Read-only git:

```text
git status
```

```text
git log
```

```text
git diff
```

Forbidden write test:

```text
git commit
```

Expected:

- Project path is saved.
- Recent files and git status/log/diff work.
- Write operations are rejected.

## 12. Try RAG

If RAG is enabled:

1. Add or index a small `.md`, `.txt`, `.json`, `.pdf`, or image document.
2. Ask Ari a question that depends on that document.

Expected:

- Ari uses relevant document fragments.
- She says “по документу” only when RAG fragments are actually present.

## 13. Try Safe Actions

Enable safe actions.

Ask:

```text
открой https://example.com
```

```text
скопируй в буфер: hello Ari
```

```text
создай заметку: проверить guided tour
```

Expected:

- Ari proposes an action card first.
- Allow executes the action.
- Reject does nothing.
- Ari does not claim an action is already done before confirmation.

## 14. Try Web Tools

Enable web tools.

```text
Который час?
```

```text
Найди свежую информацию про Tauri 2 capabilities.
```

Disable web tools and repeat a search-like request.

Expected:

- With tools enabled, Ari can use read-only tool results.
- With tools disabled, she does not pretend to browse.

## 15. Try Voice And Sounds

In Settings:

- Enable Blip Voice.
- Enable UI sounds.
- Toggle mute during focus/night/quiet mode.

Send normal, emotional, and technical messages.

Expected:

- Blip plays while text reveals.
- Emotion affects pitch/style enough to notice.
- Mute rules work in focus/night/quiet modes.

## 16. Try Backup

1. Add a task, goal, memory fact, and project binder.
2. Export backup ZIP.
3. Use a clean profile or reset local data.
4. Import the backup.

Expected:

- Settings, chat, memory metadata, tasks, relationship/mood, RAG metadata, and binders restore.
- Missing optional sections are handled gracefully.

## 17. Privacy Checks

Ask yourself:

- Did Ari claim she sees the screen without the eye button?
- Did Ari claim an action was done before confirmation?
- Did raw secrets appear in diagnostics?
- Did disabling activity tracking stop advisor-specific accumulation?

Expected answer: no to all.

## 18. Good First Session Checklist

By the end, a new user should have seen:

- Chat and casual conversation.
- Help/capability overview.
- Tasks and task board.
- Goals and goal progress.
- Focus/pomodoro.
- Proactive ambient bubble.
- Activity diagnostics.
- Vision.
- Memory and Teach Ari.
- Project binder and read-only git.
- Safe actions.
- Web tools.
- Voice/sounds.
- Backup/export.

## Full References

- `docs/FEATURES.md` - feature reference.
- `docs/COMMANDS.md` - chat command list.
- `docs/MANUAL_QA_CHECKLIST.md` - manual QA scenarios.
- `docs/CONFIGURATION.md` - settings reference.
- `PRIVACY.md` - local/cloud data boundaries.
