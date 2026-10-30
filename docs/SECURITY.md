# Безопасность

JAR — недоверенный исполняемый код. Что сделано (проверено тестами, где указано):

| Мера | Где | Проверено |
|---|---|---|
| Процесс эмулятора без root (uid 10001), read-only rootfs, `cap_drop: ALL`, `no-new-privileges`, лимиты CPU/RAM/PIDs | `compose.yaml` | `docker compose exec`: uid, `Read-only file system`, `CapEff=0`, `NoNewPrivs=1` |
| Нет сети у приложения: сеть `internal`, порт публикует только nginx на `127.0.0.1` | `compose.yaml`, `infrastructure/local/nginx.conf` | из контейнера `fetch` → `EAI_AGAIN`, `connect` → `ENETUNREACH` |
| Минимальное окружение JVM (нет `AUTH_TOKEN` и прочих секретов), `RLIMIT_CORE=0`, `RLIMIT_FSIZE` 256 МБ, опц. `RLIMIT_CPU` (`KEM_CPU_SECONDS`) | `adapter.ts`, `main.rs` | код; лимиты по CPU/файлам отдельным тестом не проверялись |
| `PDEATHSIG` + `kill(-pgid)`: JVM не переживает адаптер, лишних процессов нет | `main.rs` | тесты «краш JVM», «shutdown», `javaProcs()==0` |
| Время жизни: максимум сессии, idle-таймаут, лимит числа сессий | `sessions.ts` | тест лимита сессий |
| Загрузка: лимит размера, квота библиотеки, дедупликация по SHA-256, имя файла клиента не используется; ZIP: запрет `..`, `/`, `\`, лимиты записей/суммарного размера (zip-bomb) | `jar.ts`, `library.ts` | юнит-тесты `jar.test.ts` |
| Loopback по умолчанию; без `AUTH_TOKEN` публичный `HOST` не стартует | `config.ts` | тест «refuses to listen publicly» |
| Защита localhost-API от DNS rebinding/CSRF: проверка `Host` и `Origin` | `server.ts` | тесты `bad_host`/`bad_origin` |
| Авторизация: Bearer или HttpOnly+SameSite=Strict cookie (HMAC от токена); WS проходит ту же проверку | `server.ts` | тест auth |
| Лимит и размер клиентских WS-сообщений (8 КБ, 400/с), валидация кодов клавиш и координат | `server.ts`, `sessions.ts` | код |
| CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff` | `server.ts` | код |

**Известные пробелы.** Нет seccomp/gVisor-профиля поверх Docker: ядро хоста общее. Для публичного хостинга нужен
отдельный VM/microVM на сессию (Cloudflare Containers это даёт, см. CLOUDFLARE.md) и per-user квоты. Один владелец (`default`),
нет многопользовательской модели и rate-limit на REST. Сетевой доступ MIDlet «всё или ничего» (internal-сеть или egress override),
фильтрации по хостам нет. `npm audit` показывает уязвимости dev-сервера Vite 5/esbuild (только dev-режим).
