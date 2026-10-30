<div align="center">

# JGO

**Self-hosted веб-плеер для игр Java ME (J2ME).**
Игры работают в настоящем эмуляторе [KEmulator nnmod](https://github.com/shinovon/KEmulator) на вашем сервере и открываются в любом браузере.

[![CI](https://github.com/grayhex/JGO/actions/workflows/ci.yml/badge.svg)](https://github.com/grayhex/JGO/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#лицензия)
![Proxmox VE](https://img.shields.io/badge/Proxmox%20VE-LXC-E57000)

[English](README.en.md) · Русский

<img src="docs/img/player-landscape.gif" alt="Midnight Pool 2 в телефоне Nokia E71: игра запущена в JGO" width="560">

</div>

## Возможности

**Эмуляция**
- Игры исполняются эмулятором [KEmulator nnmod](https://github.com/shinovon/KEmulator) на сервере; в браузер передаются кадры, звук и события ввода. Эмуляция на JavaScript не используется.
- 2D, звук (MMAPI), RMS-сохранения, 3D (M3G / JSR-184 на программном OpenGL Mesa llvmpipe).
- 59 профилей устройств KEmulator: разрешение, раскладка клавиш, политика полноэкранного режима.
- Сессия живёт на сервере: обновление страницы и обрыв сети не прерывают игру, повторное открытие подключается к ней же.

**Интерфейс**
- Пять телефонов на выбор — Nokia 6100, 6230i, N95-1, E71, Sony Ericsson K750i; живой кадр показывается в окне телефона без растяжения, вид «Screen» увеличивает экран.
- Кнопки корпуса, экранная клавиатура, клавиатура ПК, геймпад (с переназначением), мультитач.
- Поворот картинки и режим «альбомная игра» на Nokia E71 для игр, рассчитанных на другую ориентацию; подсказка о разрешении, которое игра объявляет в манифесте.
- Режим Lights Out, полноэкранный режим, светлая и тёмная темы, адаптивная вёрстка, интерфейс на английском и русском.

**Библиотека**
- Загрузка JAR/JAD перетаскиванием либо импорт каталога целиком (рекурсивно): манифест и JAD, SHA-256, поиск дубликатов, несколько версий одной игры.
- Обновление библиотеки без повторного импорта; игры, настройки, избранное и сохранения никогда не удаляются сканированием.
- Необязательная интеграция с [MobyGames](https://www.mobygames.com): обложки, описания, жанры, издатели, годы, оценки, скриншоты; приоритет платформы J2ME и ручной выбор при неоднозначном совпадении.
- Без MobyGames библиотека работает на метаданных JAR.

**Установка и эксплуатация**
- Установка одной командой в LXC-контейнер Proxmox VE по образцу [Proxmox VE Community Scripts](https://github.com/community-scripts/ProxmoxVE): без Docker, под systemd, от отдельного пользователя.
- Мастер первого запуска и раздел Settings: настройки редактируются в браузере, без правки конфигов.
- Команда `jgo`: обновление с проверкой SHA-256 и откатом, резервные копии, восстановление, диагностика.
- Каталог с играми на хосте подключается как read-only bind mount.
- Запасной вариант — Docker Compose.

**Безопасность**
- Код игры считается недоверенным: отдельный пользователь, песочница systemd, лимиты cgroup, игры без доступа к сети.
- Доступ по токену; секреты (ключ MobyGames) хранятся только на сервере; API читает файлы только внутри явно разрешённых каталогов.

## Скриншоты

<table>
<tr>
<td width="50%"><img src="docs/img/library.png" alt="Библиотека"><br><sub>Библиотека</sub></td>
<td width="50%"><img src="docs/img/player.png" alt="Плеер"><br><sub>Плеер: Nokia E71, альбомная игра</sub></td>
</tr>
<tr>
<td><img src="docs/img/player-portrait.gif" alt="Assassin's Creed в Nokia N95"><br><sub>Портретная игра в Nokia N95-1</sub></td>
<td><img src="docs/img/player-screen.png" alt="Вид Screen"><br><sub>Вид «Screen»: увеличенный экран</sub></td>
</tr>
<tr>
<td><img src="docs/img/wizard.png" alt="Мастер первого запуска"><br><sub>Мастер первого запуска: состояние системы</sub></td>
<td><img src="docs/img/settings.png" alt="Настройки"><br><sub>Settings: каталог игр и отчёт об импорте</sub></td>
</tr>
<tr>
<td><img src="docs/img/library-dark.png" alt="Тёмная тема"><br><sub>Тёмная тема</sub></td>
<td><img src="docs/img/mobile.png" alt="Мобильный вид" width="220"><br><sub>Мобильный вид</sub></td>
</tr>
</table>

Игры на снимках — Midnight Pool 2 и Assassin's Creed © Gameloft; в репозиторий они не входят.

## Быстрый старт

### Proxmox VE (рекомендуется)

Выполните в оболочке хоста Proxmox VE:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/grayhex/JGO/main/ct/jgo.sh)"
```

Будет создан непривилегированный LXC на Debian 13 (4 CPU, 4 ГБ RAM, 20 ГБ диска) с Node.js 22, OpenJDK 21, Xvfb, Mesa, Rust-супервизором Bridge и KEmulator nnmod. Токен доступа выводится в конце установки; позже его можно показать командой `jgo token` внутри контейнера.

Откройте `http://<IP контейнера>:8080`, войдите по токену и пройдите мастер первого запуска.

> Не публикуйте порт 8080 в интернет без VPN или TLS-прокси.

| Путь | Назначение |
|---|---|
| `/opt/jgo` | приложение (только чтение для сервиса) |
| `/var/lib/jgo` | библиотека, сохранения, настройки |
| `/etc/jgo/jgo.env` | конфигурация окружения и токен |

Подробности: [docs/PROXMOX.md](docs/PROXMOX.md), резервные копии и перенос — [docs/BACKUP.md](docs/BACKUP.md).

### Docker Compose

```bash
docker compose up --build
```

Откройте <http://localhost:8080>. Порт публикуется только на `127.0.0.1`; перед публикацией задайте `AUTH_TOKEN` (не короче 16 символов). Контейнер игры запускается без root, с `read_only`, `cap_drop: ALL`, лимитами CPU/RAM/PID и без доступа к сети. Данные хранятся в томе `j2me-data`.

### Из исходников

Требуются Linux или WSL2, Node.js ≥ 22.13, OpenJDK 21, Rust, Xvfb и Mesa.

```bash
sudo apt install openjdk-21-jdk-headless git nodejs xvfb libgl1-mesa-dri
npm run setup      # сборка KEmulator (закреплённый коммит + патчи), Rust-адаптера и веб-интерфейса
npm start          # http://127.0.0.1:8080
```

Для 3D нужен дисплей с GLX: `Xvfb :99 -screen 0 640x480x24 +extension GLX &`, затем `KEM_DISPLAY=:99 LIBGL_ALWAYS_SOFTWARE=1 npm start`. 2D и звук работают без дисплея.

## Использование

1. **Добавьте игры.** Перетащите `.jar` (и при желании `.jad`) в окно либо подключите каталог с коллекцией: *Settings → Game library → Scan library folder*. Для Proxmox: `tools/proxmox/jgo-library-mount.sh <CTID> /путь/на/хосте` (подробнее — [docs/LIBRARY.md](docs/LIBRARY.md)).
2. **Запустите игру.** Откройте карточку и нажмите *Start*. Звук включается по первому действию пользователя — так требует браузер.
3. **Управляйте.** Клавиши цифр и стрелок, Enter — «Fire»; кнопки на корпусе телефона; экранная клавиатура; геймпад. Раскладка меняется кнопкой *Keys…* и в профиле устройства.
4. **Подберите экран.** Если игра обрезана или нарисована в углу, она рассчитана на больший экран: JGO предложит разрешение из манифеста, а общий список включает 320×480 и 480×800. Если игра нарисована «боком», она рассчитана на альбомную ориентацию: кнопка *Landscape* поворачивает картинку и переключает телефон на Nokia E71 с альбомным дисплеем. Поворот — только вид, игре о нём не сообщается; он запоминается для каждой игры.
5. **Выходите через Stop.** Остановка вызывает штатный `destroyApp()`, сохранения RMS записываются атомарно.

## Совместимость

JGO запускает то, что умеет запускать KEmulator: MIDP 2.0 / CLDC 1.0–1.1, class-файлы версии ≤ 48 (то есть настоящие J2ME-JAR; более новые отклоняются при загрузке с понятным сообщением).

Проверено вручную на трёх коммерческих играх Gameloft (The Amazing Spider-Man, Assassin's Creed, Midnight Pool 2) и автоматически на собственных MIDlet проекта: 2D, звук, M3G, RMS. Практические выводы:
- многие игры 2007–2012 годов рассчитаны на экраны 320×480–480×800 и при 240×320 обрезаны; часть игр — на альбомную ориентацию;
- Mascot Capsule 3D не проверялась;
- экраны `TextBox` и `List` Bridge-фронтенд KEmulator не реализует;
- игры не имеют доступа к сети (`jgo network allow` отключает изоляцию).

Подробнее: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md); пакетный статический и динамический анализ своей коллекции — [docs/LAB.md](docs/LAB.md).

## Архитектура

```
браузер (React) ⇄ WebSocket / REST ⇄ apps/api (Fastify) ⇄ stdio ⇄ kem-adapter (Rust) ⇄ FIFO + mmap ⇄ KEmulator (JVM)
```

| Компонент | Назначение |
|---|---|
| `apps/web` | React + Vite: библиотека, плеер, `PhoneSkin`, мастер и Settings, ввод, i18n |
| `apps/api` | Fastify: REST, WebSocket-поток, SQLite-библиотека, сессии, импорт, MobyGames, лимиты, авторизация |
| `bridge/kemulator-adapter` | Rust: рукопожатие Bridge по FIFO, framebuffer через mmap, супервизор процесса |
| `packages/protocol` | общие типы и константы протокола |
| `runtime/` | сборка KEmulator, патчи, Java-микшер звука, Dockerfile |
| `packaging/`, `ct/`, `install/`, `json/` | релиз, команда `jgo`, unit-файлы systemd, скрипты Proxmox VE |
| `tools/` | скрипты скинов телефонов, bind mount для Proxmox, подготовка релиза, снимки для README |

Технические особенности:
- **Протокол.** Кадры передаются бинарными WebSocket-сообщениями, при отставании клиента устаревший кадр отбрасывается (латентность важнее полноты). Кадр можно сжимать deflate (`FRAME_ENCODING`). Звук — PCM 44,1 кГц, воспроизводится через AudioWorklet (при `http://` — через ScriptProcessor).
- **Ввод.** Источники ввода (клавиатура, геймпад, касания, кнопки корпуса) считаются по ссылкам: несколько источников могут удерживать одну клавишу, потеря фокуса и отключение отпускают только свои.
- **Телефоны.** Картинка телефона — слой над живым canvas; разрешение эмуляции от картинки не зависит. Окно экрана берётся из `config.json`, масштабирование — вписывание без растяжения.
- **Сессии.** WebSocket — всего лишь зритель: JVM живёт до остановки либо таймаута простоя. Остановка и SIGTERM вызывают `destroyApp()`, запись RMS — через временный файл, fsync и атомарное переименование. Сохранения состояния (save states) не эмулируются. См. [docs/SESSION_RECOVERY.md](docs/SESSION_RECOVERY.md).
- **Библиотека.** Содержимое адресуется по SHA-256; сканер не следует по симлинкам и не выходит за разрешённые каталоги (`LIBRARY_ROOTS`), миграции БД только добавляют таблицы и столбцы, поэтому откат релиза безопасен.
- **Эмулятор.** KEmulator nnmod v2.22, коммит `9ec1005af5448bca63a420e1dfa884ef53842d0f`, собирается из исходников с небольшими патчами (`runtime/patches`, описание — [docs/BRIDGE.md](docs/BRIDGE.md)); исходники и бинарники KEmulator в репозиторий не входят.

Подробнее: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Конфигурация

Большинство параметров меняется в *Settings*. Низкоуровневые значения задаются в `/etc/jgo/jgo.env` (после правки: `systemctl restart jgo`):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `HOST`, `PORT` | `0.0.0.0`, `8080` | адрес и порт |
| `AUTH_TOKEN` | генерируется | токен доступа (≥ 16 символов); без него сервер слушает только loopback |
| `ALLOWED_ORIGINS` | — | дополнительные origin за обратным прокси |
| `MAX_SESSIONS` | `1` | число одновременных игр (≈ 0,25–0,5 ГБ и ядро CPU на игру) |
| `SESSION_MAX_MINUTES`, `SESSION_IDLE_MINUTES` | `120`, `5` | предел длительности и таймаут простоя |
| `MAX_UPLOAD_MB`, `LIBRARY_QUOTA_MB` | `32`, `4096` | размер файла и квота библиотеки |
| `FRAME_ENCODING` | `deflate` | `deflate` или `raw` |
| `LIBRARY_ROOTS` | `/mnt/jgo-library /srv/jgo-library` | каталоги, из которых можно выбрать папку с играми |
| `MOBYGAMES_API_KEY` | — | ключ MobyGames (обычно вводится в Settings) |
| `KEM_DISPLAY` | `:99` | X-дисплей для 3D |
| `KEM_JVM_ARGS`, `KEM_LAUNCH_WRAPPER` | см. `jgo.env.example` | параметры JVM и изоляция сети |

Полный список — `packaging/jgo.env.example`.

## Администрирование

| Команда | Действие |
|---|---|
| `jgo status` | версия, службы, адрес, health, размер данных |
| `jgo update [--check] [--to vX.Y.Z]` | обновление: SHA-256, резервная копия, проверка работоспособности, автоматический откат |
| `jgo backup` / `jgo restore FILE` | резервная копия и восстановление (библиотека, сохранения, настройки, ключ MobyGames) |
| `jgo rollback` | вернуться к предыдущему релизу |
| `jgo doctor [--online]` | проверка системы, песочницы, лимитов, доступа, каталога игр, бэкапов |
| `jgo library` | каталоги библиотеки: подключены ли, читает ли их служба |
| `jgo token [--rotate]` | показать или заменить токен |
| `jgo network [deny\|allow]` | сетевой доступ игр |
| `jgo logs [-f]` | журнал служб |

## Безопасность

- Игра — недоверенный код. Сервис работает от пользователя `jgo` без capabilities, с `NoNewPrivileges`, фильтром системных вызовов, `ProtectSystem=strict`, лимитами памяти, процессов и CPU; приложение доступно сервису только для чтения. Каждая игра запускается в собственном сетевом пространстве имён без интерфейсов.
- Проверки `Host` и `Origin`, токен или cookie для всех эндпоинтов API, кроме `/api/health`.
- Веб-интерфейс и API не читают файлы вне разрешённых каталогов; пути разыменовываются через `realpath`, симлинки не обходятся.
- Ключ MobyGames хранится в `secrets.json` (права 0600) и не возвращается API; картинки скачивает сервер, и только с хостов `mobygames.com`.
- JGO не скачивает игры из интернета.

Модель угроз и рекомендации: [docs/SECURITY.md](docs/SECURITY.md).

## Разработка

```bash
npm run build          # production-сборка
npm run build:dev      # сборка с инструментами разработчика (Lab, страница выравнивания скинов)
npm test               # юнит-тесты API и веб-части
npm run test:integration   # тесты на настоящем KEmulator: кадры, ввод, RMS, 3D, звук, регрессии Bridge
npm run test:e2e           # браузерные сценарии в Chromium
cargo test --manifest-path bridge/kemulator-adapter/Cargo.toml
python3 tools/phones/validate_assets.py   # проверка ассетов телефонов (Pillow, NumPy)
```

CI проверяет сборку, юнит-, интеграционные и браузерные тесты, а также установку в настоящий непривилегированный LXC-контейнер и в Docker. Границы production и dev-инструментов описаны в [docs/PRODUCTION_DEVELOPMENT.md](docs/PRODUCTION_DEVELOPMENT.md). Снимки для этого файла создаёт `tools/docs/capture-readme.mjs` (понадобятся собственные JAR).

## Документация

| Документ | Содержание |
|---|---|
| [PROXMOX.md](docs/PROXMOX.md) | установка, настройка, обновление, диагностика |
| [BACKUP.md](docs/BACKUP.md) | Proxmox Backup Server, `jgo backup`, перенос |
| [LIBRARY.md](docs/LIBRARY.md) | мастер, настройки, импорт, MobyGames |
| [UI.md](docs/UI.md) | интерфейс, `PhoneSkin`, телефоны |
| [PLAYER_CONTROLS.md](docs/PLAYER_CONTROLS.md) | профили устройств, Lights Out, геймпады |
| [SESSION_RECOVERY.md](docs/SESSION_RECOVERY.md) | восстановление сессий, сохранение RMS |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md), [BRIDGE.md](docs/BRIDGE.md) | устройство системы, патчи Bridge |
| [COMPATIBILITY.md](docs/COMPATIBILITY.md), [LAB.md](docs/LAB.md) | совместимость и лаборатория |
| [SECURITY.md](docs/SECURITY.md) | безопасность |

## Ограничения

- Один владелец (`default`); сохранения изолированы по играм и версиям, учётных записей пользователей нет.
- По умолчанию одна одновременная сессия.
- Скины телефонов — иллюстрации в статусе *review draft*: геометрия проверена автоматически, историческая точность не подтверждена.
- Интеграция MobyGames проверена на локальной заглушке API; условия использования API определяются вашим тарифом.

## Благодарности

- [KEmulator nnmod](https://github.com/shinovon/KEmulator) (shinovon) — эмулятор, на котором построен JGO.
- [Proxmox VE Community Scripts](https://github.com/community-scripts/ProxmoxVE) — формат и практики скриптов установки.
- [MobyGames](https://www.mobygames.com) — метаданные и изображения при включённой интеграции.

## Лицензия

Код репозитория распространяется по лицензии MIT. KEmulator nnmod не поставляется вместе с проектом: он собирается из исходников апстрима при сборке релиза или образа. Апстрим содержит код под GPLv3, Apache-2.0 и EPL (см. README KEmulator); перед публичным распространением собранных артефактов уточните условия у автора либо распространяйте только скрипты сборки. Названия игр и торговые марки принадлежат их владельцам.
