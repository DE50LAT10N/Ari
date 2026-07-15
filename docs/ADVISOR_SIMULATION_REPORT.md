# Ari advisor simulation report

Generated: 2026-07-15T10:17:47.308Z

| Scenario | Expected | Actual | Initiative | Value/Risk | Flags | Topics |
|----------|----------|--------|------------|------------|-------|--------|
| long_session_rest | rest | rest | allowed | medium/low | breakDue | ChatPanel.tsx; короткий перерыв после долгой сессии |
| repeated_stacktrace_debug | debug_help | debug_help | allowed | high/low | stuck=0.70 | Error: failed to load model
 at ChatPanel.tsx:2144; ChatPanel.tsx |
| rapid_switch_refocus | refocus | refocus | allowed | low/low | contextThrash | state.ts |
| many_open_tasks_scope | scope | scope | allowed | low/low | scopeCreep | roadmap.md |
| recent_topic_check_in | topic | topic | allowed | medium/low | none | activeWindow.ts; Tauri active window permissions |

## Prompt previews

### long_session_rest

Практическая польза не отменяет характер Ari: ирония, ритм, тепло и наблюдательность в формулировках; без канцелярита и тона «виртуального помощника». Реплика — как строка из visual novel: один характерный заход, субъект

### repeated_stacktrace_debug

Практическая польза не отменяет характер Ari: ирония, ритм, тепло и наблюдательность в формулировках; без канцелярита и тона «виртуального помощника». Реплика — как строка из visual novel: один характерный заход, субъект

### rapid_switch_refocus

Практическая польза не отменяет характер Ari: ирония, ритм, тепло и наблюдательность в формулировках; без канцелярита и тона «виртуального помощника». Реплика — как строка из visual novel: один характерный заход, субъект

### many_open_tasks_scope

Практическая польза не отменяет характер Ari: ирония, ритм, тепло и наблюдательность в формулировках; без канцелярита и тона «виртуального помощника». Реплика — как строка из visual novel: один характерный заход, субъект

### recent_topic_check_in

Практическая польза не отменяет характер Ari: ирония, ритм, тепло и наблюдательность в формулировках; без канцелярита и тона «виртуального помощника». Реплика — как строка из visual novel: один характерный заход, субъект

## Proactive cadence

| Level | Configured | Effective interval | First check tick | Starts | Reason |
|-------|------------|--------------------|------------------|--------|--------|
| active | 1 min | 21 sec | 30 sec | yes | плановая проверка после тишины |
| normal | 1 min | 60 sec | 60 sec | yes | плановая проверка после тишины |
| rare | 1 min | 96 sec | 105 sec | yes | плановая проверка после тишины |
| silent | 1 min | 150 sec | 150 sec | no | нет достаточно конкретного повода |

## Topic following

| Check | Result | Topics | Reason |
|-------|--------|--------|--------|
| planned_check_uses_recent_topics | pass | activeWindow.ts; Tauri active window permissions | плановая проверка после тишины |
| repeat_guard_rotates_to_file_topic | pass | activeWindow.ts; Tauri active window permissions | плановая проверка после тишины |