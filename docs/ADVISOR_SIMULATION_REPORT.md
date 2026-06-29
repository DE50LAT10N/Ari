# Ari advisor simulation report

Generated: 2026-06-29T05:40:15.289Z

| Scenario | Expected | Actual | Initiative | Value/Risk | Flags | Topics |
|----------|----------|--------|------------|------------|-------|--------|
| long_session_rest | rest | rest | allowed | medium/low | breakDue | как идёт ChatPanel.tsx; короткий перерыв после долгой сессии |
| repeated_stacktrace_debug | debug_help | debug_help | allowed | high/low | stuck=0.70 | как идёт ChatPanel.tsx; получилось ли разобраться с ошибкой из буфера |
| rapid_switch_refocus | refocus | refocus | allowed | low/low | contextThrash | как идёт state.ts |
| many_open_tasks_scope | scope | scope | allowed | low/low | scopeCreep, taskLink? | уточнить связь активности с задачей «Open task 7»; как идёт roadmap.md |
| recent_topic_check_in | topic | topic | allowed | medium/low | none | как идёт activeWindow.ts; что нашёл по «Tauri active window permissions»; ещё актуально «Tauri active window permissions» |

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
| active | 1 min | 39 sec | 45 sec | yes | плановая проверка после тишины |
| balanced | 1 min | 60 sec | 60 sec | yes | плановая проверка после тишины |
| rare | 1 min | 96 sec | 105 sec | yes | плановая проверка после тишины |
| silent | 1 min | 150 sec | 150 sec | no | нет достаточно конкретного повода |

## Topic following

| Check | Result | Topics | Reason |
|-------|--------|--------|--------|
| planned_check_uses_recent_topics | pass | как идёт activeWindow.ts; что нашёл по «Tauri active window permissions»; ещё актуально «Tauri active window permissions» | плановая проверка после тишины |
| repeat_guard_rotates_to_file_topic | pass | как идёт activeWindow.ts; что нашёл по «Tauri active window permissions»; ещё актуально «Tauri active window permissions» | плановая проверка после тишины |