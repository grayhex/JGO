# Архитектура

```
 Browser                      apps/api (Node 22, Fastify)                 kem-adapter (Rust)            KEmulator (JVM)
┌──────────────┐  REST        ┌───────────────────────────┐  stdio frames  ┌──────────────────┐ FIFO+mmap ┌────────────┐
│ React UI     │─────────────▶│ library (SQLite + files)  │               │ supervisor        │◀─────────▶│ Bridge     │
│ canvas       │  WS binary   │ SessionManager / Session  │◀─────────────▶│ frame copy + ack  │  audio    │ frontend   │
│ AudioWorklet │◀════════════▶│ KEmulatorAdapter (TS)     │               │ audio FIFO reader │◀──FIFO────│ + Java     │
└──────────────┘  frames/PCM  └───────────────────────────┘               └──────────────────┘           │ Sound shim │
                  ←key events                                                                              └────────────┘
```

* **Слои независимы от провайдера.** React ходит только на `/api/*` и `WS /api/sessions/:id/stream` с относительными URL;
  в LXC (основной вариант), Docker Compose или за обратным прокси это один порт и тот же путь. Логики развёртывания в клиенте нет.
* **KEmulatorAdapter** (`apps/api/src/kemulator/adapter.ts`): `start`, `stop`, `keyDown`, `keyUp`, `pointerEvent`, `getStatus`,
  события `frame`, `audio`, `state`, `log`, `exit`. Держит набор нажатых клавиш, `releaseAll()`.
* **Session** — на клиентов: WebSocket-подписчики, у каждого свои нажатые клавиши (отпускаются при разрыве), кэш последнего кадра
  (переподключение сразу показывает картинку), диагностика по логу (ClassNotFound, OOM, версия классов, GL, …).
* **Кадры**: `[0x01][seq u32][enc u8][w u16][h u16][ts u32][RGBA | raw-deflate(RGBA)]`. Исходное разрешение сохраняется,
  масштабирование — на клиенте (CSS, `image-rendering: pixelated`, integer/fit). Медленному клиенту кадры пропускаются
  (`bufferedAmount`), очередей нет. Аудио: `[0x02][s16le stereo 44.1k]`, включается сообщением `{t:'audio',on:true}`.
* **Хранилище MVP**: SQLite (`node:sqlite`, без нативных зависимостей) + файлы: `games/<id>/{game.jar,game.jad,icon.png}`,
  `saves/<owner>/<gameId>/` (RMS), `logs/<session>.log`. `id` = первые 16 hex SHA-256 JAR, версии одной игры группируются по (vendor, name).
* **Сессии**: лимит `MAX_SESSIONS`, `SESSION_MAX_MINUTES`, останов через `SESSION_IDLE_MINUTES` без зрителей, чистка каталога сессии,
  при старте сервера удаляются «осиротевшие» каталоги; при падении Node адаптер видит EOF stdin и убивает JVM (`PDEATHSIG` — на случай SIGKILL адаптера).

## Нагрузка (замер: 4 vCPU песочница, 240×320, тестовый MIDlet 30 fps)

| | raw RGBA | deflate (level fast) |
|---|---|---|
| Скорость кадров на клиенте | 29 fps | 29 fps |
| Размер кадра на проводе | 307 200 B (71 Мбит/с) | ≈5.7 KB (1.3 Мбит/с) на этой сцене |
| CPU: JVM / адаптер / Node | 3.5 % / 2 % / 17 %* | 3.7 % / 1.8 % / 3.3 % |
| RSS: JVM / адаптер / Node | 93 / 4 / 241 MB | 94 / 4 / 233 MB |
| Старт сессии → первый кадр | ≈0.75 с | ≈0.75 с |
| Нажатие → кадр с реакцией (localhost) | 13–25 мс | |

\* в этом замере Node-процесс ещё и принимал WebSocket-клиентом теста. 3D (M3G, llvmpipe): 26–27 fps, см. COMPATIBILITY.
Размер deflate-кадра зависит от сцены (динамичные 3D-сцены сжимаются хуже); в compose по умолчанию `FRAME_ENCODING=deflate`.
