# Manual QA checklist

Use this checklist for features that are not fully covered by automated tests.

## Setup

- Run `npm run tauri dev`.
- Use a working LLM provider: Ollama or GigaChat.
- Settings:
  - Proactive messages: on.
  - Programmer advisor: on.
  - Activity tracking: on.
  - Full clipboard capture: on.
  - Quiet mode: off.
  - For proactive tests only: initiative level `active`, interval `1 min`.
- Open Settings -> Diagnostics before signal tests.

## 1. Proactive Advisor End-to-End

Steps:

1. Set proactive interval to `1 min`, level `active`.
2. Close chat, keep Ari visible.
3. Work in an IDE window for 1-2 minutes.
4. Ask or search something related to the current file, for example `Tauri active window permissions`.
5. Wait for the next proactive check.

Expected:

- Ari starts a relevant conversation or ambient bubble.
- The topic mentions recent work, file, query, or focus context.
- She does not claim she sees the screen directly.
- Diagnostics show advisor angle or recent activity signals.

Fail if:

- Ari stays silent for 3+ effective intervals while provider is online.
- Ari repeats the same topic several times.
- Ari says she sees the screen without a vision action.

Task/activity link variant:

1. Add an open task: `добавь задачу проверить Tauri active window permissions`.
2. Work in/search for `Tauri active window permissions` or keep `activeWindow.ts` focused for 1-2 minutes.
3. Wait for the next proactive check.
4. Repeat with an unrelated open task, for example `добавь задачу написать отчёт недели`, while working in code.

Expected:

- If the activity clearly matches the task, Ari uses the task as context for a concrete next step.
- If the relation is unclear, Ari asks whether the current activity is connected to that task.
- The task-link topic wins over a generic `как идёт activeWindow.ts` file check-in.
- She does not silently mutate the task/goal without user confirmation.

## 1.1 Goal Inference On Completed Tasks

Steps:

1. Add a current goal: `добавь цель Допилить Ari 0%`.
2. Add another goal: `добавь цель Отчёт недели 0%`.
3. Switch focus back: `фокус на цель Допилить Ari`.
4. Add a task that belongs to the second goal: `добавь задачу собрать итоги недели`.
5. Complete it from chat: `готово: собрать итоги недели`.
6. Repeat once from the task board Done button.

Expected:

- Ari asks the LLM to choose the best goal for the completed task, with local scoring as fallback.
- `Отчёт недели` receives progress, not the current `Допилить Ari` goal.
- The completed task metadata contains goal inference source/confidence when inspected in localStorage.

## 2. Long Focus / Break Suggestion

Steps:

1. Set proactive level `active`.
2. Keep one IDE window active for 50+ minutes, or simulate a long session if a debug helper exists.
3. Keep quiet mode off and provider online.
4. Wait for proactive check.

Expected:

- Ari suggests a short break softly.
- Message is not pushy and does not lecture.
- Diagnostics/advisor flags show `breakDue`.

## 3. Ambient Bubble With Chat Closed

Steps:

1. Disable `Open chat for proactive messages` if available.
2. Close chat panel.
3. Trigger a proactive check-in or event reaction.

Expected:

- Ari shows an ambient bubble near the avatar.
- Bubble disappears automatically.
- Emotion changes briefly and returns to normal.
- Chat history is not unexpectedly opened.

## 4. Activity Signals / Diagnostics

Steps:

1. Open Settings -> Diagnostics.
2. Copy normal code to clipboard.
3. Copy a stack trace to clipboard.
4. Copy a fake secret: `password=super-secret-value`.
5. Stay in an IDE file for 5+ minutes, then switch windows.
6. Open a browser tab/search title related to current work.

Expected:

- Clipboard signals appear with kind `code`, `stacktrace`, or similar.
- Secret is redacted in stored signal text.
- File focus appears after sufficient dwell.
- Query topic appears for browser/chat topic.
- Advisor topics include file/query context.

Fail if:

- Raw secret appears in diagnostics or localStorage.
- Advisor disabled but new advisor query topics are still stored.

## 5. Advisor Off Privacy Check

Steps:

1. Turn Programmer advisor off.
2. Ask/search a new topic.
3. Copy code or stack trace.
4. Inspect Diagnostics and localStorage key `desktop-character.activity-signals.v1`.

Expected:

- Advisor-specific query/file-focus accumulation stops.
- Clipboard behavior follows its own toggles.
- Capabilities overview says advisor is off.

## 6. Vision One-Shot Overview

Steps:

1. Enable vision provider.
2. Open a visible app window with readable text.
3. Click the eye button.
4. Choose overview mode.

Expected:

- Ari hides before capture.
- The captured image is not kept after processing.
- Response describes visible content conservatively.
- No crash if model returns empty/slow response.

## 7. Vision OCR / Region / Compare

Steps:

1. Use OCR mode on a window with readable text.
2. Use region select and select a smaller area.
3. Use compare mode:
   - Take first capture.
   - Change visible UI/text.
   - Take second capture.

Expected:

- OCR preserves important text order.
- Region mode only describes selected area.
- Compare mode lists actual differences.
- Ari does not invent hidden content.

## 8. Task Board UI

Steps:

1. Close chat.
2. Add a task via chat: `добавь задачу проверить manual QA`.
3. Close chat again.
4. Add several tasks and one reminder.
5. Resize window from about `400x560` to `800x900`.

Expected:

- Task board appears beside avatar when chat is closed.
- Empty board hides when no tasks exist.
- Board does not cover Ari or ambient bubbles.
- Text does not overflow buttons/cards.
- Done/snooze/next controls work.

## 9. Reminder Due Notification

Steps:

1. Create reminder due in 1-2 minutes: `напомни проверить сборку через 2 минуты`.
2. Keep app running.
3. Wait until due time.

Expected:

- Reminder becomes due.
- Ari speaks or shows a notification according to settings.
- Reminder is not repeated endlessly after acknowledged/done.

## 10. Focus And Pomodoro UI

Steps:

1. Start focus: `старт фокуса: проверить инициативы`.
2. Add step: `фокус: шаг прогнать симулятор`.
3. Add blocker: `блокер: модель молчит`.
4. Start pomodoro from board.
5. Pause/resume, switch to break, finish focus.

Expected:

- Current goal/step/blockers appear in UI and prompts.
- Pomodoro phase and timers update correctly.
- Quiet/body-doubling behavior matches settings.
- Focus recap is generated or gracefully skipped if model fails.

## 11. Project Binder And Git Read-Only

Steps:

1. Bind current project folder: `запомни это как текущий проект <PROJECT_ROOT>`.
2. Run `прикрепи readme`.
3. Run `покажи последние изменённые файлы`.
4. Ask `git status`, `git log`, `git diff`.
5. Ask a forbidden command: `git commit`.

Expected:

- Project path is saved.
- README is pinned/read.
- Recent files are listed.
- Git status/log/diff are read-only.
- Write command is rejected.

## 12. Teach Ari Mode

Steps:

1. Enable Teach mode.
2. Add a behavior rule, for example: `не называй меня пользователь`.
3. Send a normal chat message.
4. Restart app.
5. Send another chat message.

Expected:

- Rule is saved locally.
- Ari follows it in later replies.
- Rule persists after restart.
- Rule does not override safety/privacy boundaries.

## 13. Safe Actions UI

Steps:

1. Ask Ari to open a URL.
2. Ask Ari to copy text to clipboard.
3. Ask Ari to create a note.
4. Reject one proposal.
5. Allow one proposal.

Expected:

- Ari does not claim action is done before confirmation.
- Proposal card appears with Allow/Reject.
- Rejected action is not executed.
- Allowed action runs and shows result.

## 14. Backup Export / Import

Steps:

1. Add a task, memory-relevant chat fact, and project binder.
2. Export backup ZIP.
3. Reset local data or use a clean profile.
4. Import backup ZIP.

Expected:

- Settings, chat, memory metadata, tasks, relationship/mood, RAG metadata, and binders restore.
- Import handles missing optional sections gracefully.
- Newer backup version warning appears when applicable.

## 15. Window, Tray, Autostart

Steps:

1. Drag Ari window.
2. Resize from corner.
3. Restart app.
4. Hide to tray.
5. Restore from tray.
6. Press Alt+F4.
7. Toggle autostart setting.

Expected:

- Position and size restore after launch.
- Alt+F4 hides instead of quitting.
- Tray restore works.
- Full shutdown button quits cleanly.
- Autostart setting is saved and reflected by OS integration.

## 16. Provider Failure Handling

Steps:

1. Stop Ollama or use invalid GigaChat key.
2. Send chat message.
3. Trigger proactive check.
4. Restore provider and retry.

Expected:

- Ari shows clear provider/offline error.
- Proactive status explains blocker.
- No endless loading.
- After provider restore, chat/proactive replies work again.

## 17. Web Tools

Steps:

1. Enable web tools.
2. Ask for current time.
3. Ask to search the web.
4. Ask to fetch a simple page.
5. Disable web tools and repeat.

Expected:

- With tools enabled, Ari uses read-only tool results.
- With tools disabled, she does not pretend to browse.
- Search/fetch errors are graceful.

## 18. Blip Voice And Sounds

Steps:

1. Enable blip voice and UI sounds.
2. Send normal, emotional, and technical messages.
3. Enter focus/night/quiet mode.
4. Mute/unmute voice.

Expected:

- Blip plays while text reveals.
- Pitch/style follows emotion enough to notice.
- Sounds mute during focus/night/quiet when configured.
- Stop voice button works.

## 19. Onboarding

Steps:

1. Start with clean local data.
2. Complete first-run wizard with Ollama.
3. Reset and repeat with GigaChat.
4. Select companion preset.

Expected:

- Provider settings are saved.
- API key is not stored in localStorage.
- Default toggles match chosen preset.
- App opens into usable main UI.

## 20. Release Smoke Manual

Steps:

1. Run `npm run build`.
2. Run `npm run smoke`.
3. Run `npm run test:retrieval`.
4. Run `npm run test:character`.
5. Run `npm run simulate:advisor`.
6. Build installer: `npm run tauri build -- --bundles nsis`.
7. Install and launch the installer build.

Expected:

- All automated gates pass.
- Installer launches.
- No missing assets.
- Settings and avatar render correctly.
