# JGO в Proxmox VE (LXC, без Docker)

Основной способ установки JGO — непривилегированный LXC-контейнер Debian 13 на Proxmox VE, созданный скриптом в формате
[Community Scripts](https://community-scripts.org/). Всё работает нативно: `systemd`, пользователь `jgo`, без Docker.
Docker Compose остаётся запасным вариантом (см. [README](../README.md#запасной-вариант-docker-compose)).

## Установка одной командой

В оболочке **хоста Proxmox VE** (Datacenter → узел → Shell), от root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/grayhex/JGO/main/ct/jgo.sh)"
```

Скрипт предложит «Default» или «Advanced» установку, создаст контейнер, поставит всё внутри и в конце напечатает адрес и
**токен доступа**. После установки: `http://IP_КОНТЕЙНЕРА:8080` (токен вводится один раз на странице входа).

| Параметр | По умолчанию | Как изменить |
|---|---|---|
| CPU / RAM / диск | 4 ядра / 4096 МБ / 20 ГБ | Advanced-режим, или `var_cpu=2 var_ram=3072 var_disk=40 bash -c "$(curl …)"` |
| ОС | Debian 13 | единственная проверенная |
| Тип | непривилегированный, feature `nesting=1` (по умолчанию в Community Scripts) | `nesting` нужен для сетевой изоляции игр, см. ниже |
| Архитектура | x86_64 | релиз собирается только под amd64 |

Что ставится: Node.js 22 (`setup_nodejs` движка), OpenJDK 21 headless (apt), Xvfb + Mesa (программный OpenGL для M3G и Mascot Capsule),
затем **релиз JGO** (`jgo-<версия>-linux-amd64.tar.gz` из GitHub Releases): API и веб-интерфейс, Bridge-супервизор на Rust,
KEmulator nnmod (собран в CI из закреплённого коммита с патчами из `runtime/patches`), CLI `jgo`.

> Релиз появляется, когда в репозитории поставлен тег `v<версия>` (workflow `Release`). Пока релизов нет, скрипт установки остановится
> на шаге загрузки: сначала нужно выпустить релиз (`git tag v0.2.0 && git push origin v0.2.0`).

## Раскладка

| Путь | Содержимое | Владелец |
|---|---|---|
| `/opt/jgo` | приложение (релиз): `app/`, `kemulator/`, `bin/jgo`, `bin/kem-adapter`, `share/` | `root`, для `jgo` только чтение |
| `/opt/jgo.prev` | предыдущий релиз после обновления (для `jgo rollback`) | `root` |
| `/var/lib/jgo` | **все данные**: `library.sqlite` (игры, настройки), `games/`, `saves/` (RMS), `logs/` | `jgo:jgo`, `0700` |
| `/etc/jgo/jgo.env` | конфигурация и токен доступа | `root:jgo`, `0640` |
| `/var/backups/jgo` | архивы `jgo backup` (перед обновлением и восстановлением — автоматически) | `root`, `0700` |
| `/etc/systemd/system/jgo.service`, `jgo-xvfb.service` | службы | `root` |
| `/usr/local/bin/jgo` | ссылка на `/opt/jgo/bin/jgo` | |

Службы: `jgo-xvfb` (виртуальный дисплей `:99`) и `jgo` (API, веб, сессии эмулятора). Оба включены в автозапуск; `Restart=on-failure`.

## Безопасность

JAR — недоверенный код. Слои защиты (проверяются `jgo doctor` и `tests/lxc/run.sh`):

* **Не публикуйте порт 8080 в интернет.** Сервис слушает `0.0.0.0` внутри контейнера и не стартует без токена (`AUTH_TOKEN` ≥ 16 символов),
  но это защита домашней/корпоративной сети, не публичного хостинга: нет TLS, нет ограничения попыток входа. Для доступа извне —
  VPN (WireGuard, Tailscale) или обратный прокси с TLS и внешней аутентификацией; в `ALLOWED_ORIGINS` добавьте адрес прокси.
* **Токен** генерируется при установке (`random_password`, 32 символа), лежит только в `/etc/jgo/jgo.env` (`0640 root:jgo`).
  `jgo token` показывает, `jgo token --rotate` заменяет (все сессии браузера разлогиниваются).
* **Пользователь `jgo`**: системный, без оболочки, без capabilities, `NoNewPrivileges`. Приложение в `/opt/jgo` ему доступно только на чтение.
* **Песочница systemd** (`jgo.service`): `ProtectSystem=strict` (записать можно только `/var/lib/jgo`), `ProtectHome`, `PrivateTmp`,
  `PrivateDevices`, `NoExecPaths=/var/lib/jgo` (загруженное не исполняется), `ProtectKernel*`, `ProtectControlGroups`, `RestrictNamespaces=user net`,
  `RestrictAddressFamilies`, `SystemCallFilter=@system-service` без `@privileged` (`@resources` разрешён: без него падает программный OpenGL, найдено тестом M3G), пустой `CapabilityBoundingSet`.
  `MemoryDenyWriteExecute` выключен: JIT-компилятору JVM нужны страницы W+X.
* **Лимиты cgroup** на всё, что запускает служба (API и JVM игр): `MemoryHigh=2560M`, `MemoryMax=3G`, `MemorySwapMax=0`, `TasksMax=1024`,
  `CPUQuota=300%`, `LimitNOFILE=8192`, `LimitCORE=0`, `OOMPolicy=stop`; у `jgo-xvfb` — `MemoryMax=256M`, `TasksMax=32`. Для JVM дополнительно
  `-Xmx768m -XX:MaxMetaspaceSize=192m -XX:MaxDirectMemorySize=128m -XX:+ExitOnOutOfMemoryError` (`KEM_JVM_ARGS`) и `RLIMIT_CORE=0`, `RLIMIT_FSIZE`
  от супервизора. Лимиты контейнера (4 ГБ, 4 ядра) действуют сверху.
* **Сеть игр**: каждая JVM запускается в своём сетевом пространстве имён (`unshare --user --map-current-user --net`, `KEM_LAUNCH_WRAPPER`):
  у игры нет интерфейсов, кроме `lo`, она не видит ни интернет, ни вашу LAN. Это требует `nesting=1` у контейнера. Без него
  `jgo doctor` сообщит об ошибке; тогда `jgo network allow` (игры получают сеть контейнера) и закройте исходящий трафик **файрволом Proxmox**
  (`Container → Firewall`: политика `OUT DROP`, разрешить DNS и нужные вам хосты).
* **Обработка JAR** (код `apps/api/src/jar.ts`, ничего не исполняется при загрузке): лимит размера и квота библиотеки, запрет `..`, `/`, `\` в именах записей,
  лимиты числа записей и суммарного распакованного размера (zip-bomb), имя файла клиента не используется, дедупликация по SHA-256.
* **Окружение JVM** очищено (в нём нет `AUTH_TOKEN`), игра пишет RMS только в свою папку `saves/<владелец>/<игра>`.

Что **не** сделано: нет TLS в самом сервисе, нет ограничения частоты запросов, одна учётная запись (`default`). Подробнее — [SECURITY.md](SECURITY.md).

## Обновление

Внутри контейнера работает стандартная команда Community Scripts **`update`**, она вызывает `update_script()` из `ct/jgo.sh`:
проверяет последний релиз (`check_for_gh_release`) и запускает **`jgo update`**. Можно и напрямую: `jgo update`, `jgo update --check`, `jgo update --to v0.3.0`.

Порядок `jgo update` (код — `packaging/bin/jgo`, проверен в `tests/lxc/run.sh`):

1. релиз скачивается, **SHA-256 сверяется с `SHA256SUMS`**; пути в архиве проверяются (`..`, абсолютные, ссылки за пределы дерева, специальные файлы). Любая ошибка — до остановки службы;
2. **резервная копия** (`jgo backup`, метка `pre-update-<версия>`): консистентный снимок SQLite, `saves/`, `games/`, конфигурация;
3. остановка служб, новое дерево кладётся рядом (`/opt/jgo.new`) и подменяется переименованием; старое остаётся в `/opt/jgo.prev`;
4. обновляются unit-файлы и **добавляются новые ключи** в `jgo.env` (существующие значения не трогаются);
5. запуск и **проверка**: `/api/health` должен ответить `ok` **и назвать новую версию** (до `JGO_HEALTH_WAIT`=60 с);
6. при неудаче — **автоматический откат**: прежнее дерево и конфигурация возвращаются, SQLite и RMS восстанавливаются из снимка шага 2
   (новая версия могла изменить схему), служба стартует снова; команда завершается с ошибкой.

`jgo rollback` вручную возвращает предыдущий релиз (дерево `/opt/jgo.prev`). Данные при этом не откатываются — для них `jgo restore`.

## Библиотека игр с хоста (read-only bind mount)

Коллекцию JAR/JAD можно оставить на хосте Proxmox и подключить к контейнеру **только для чтения**. JGO ничего там не пишет, не переносит и не удаляет: при импорте он копирует *новые* игры в собственную библиотеку (`/var/lib/jgo`).

```bash
# на хосте Proxmox, от root; CTID — номер контейнера JGO
tools/proxmox/jgo-library-mount.sh <CTID> /path/on/host/games      # добавит mp<N>: ...,mp=/mnt/jgo-library,ro=1 и перезапустит контейнер
tools/proxmox/jgo-library-mount.sh <CTID> --remove                   # убрать
```

Либо сразу при создании контейнера: `var_library_path=/path/on/host/games bash -c "$(curl -fsSL https://raw.githubusercontent.com/grayhex/JGO/main/ct/jgo.sh)"`.
То же вручную: `pct set <CTID> -mp0 /path/on/host/games,mp=/mnt/jgo-library,ro=1 && pct reboot <CTID>`.

Затем в JGO: **Settings → Game library** (или мастер первого запуска) → выбрать `/mnt/jgo-library` → *Check access* → *Use this folder* → *Scan library folder*.

* **Права в непривилегированном контейнере.** Пользователи контейнера отображаются на хосте как `100000+uid`, поэтому файлы должны читаться «остальными» (`chmod -R o+rX /path/on/host/games`) либо надо выдать ACL для `100000+uid` пользователя `jgo` (`pct exec <CTID> -- id -u jgo`). Скрипт предупреждает, если у каталога нет прав `o+rx`; `jgo library` и `jgo doctor` показывают, читает ли каталог служба.
* **Куда можно указывать.** Только в разрешённые каталоги: `/mnt/jgo-library`, `/srv/jgo-library` и `/var/lib/jgo/import` (список задаёт `LIBRARY_ROOTS` в `/etc/jgo/jgo.env`). Веб-интерфейс и API не читают ничего за их пределами; символические ссылки не разыменовываются.
* **Без bind mount**: скопируйте файлы в `/var/lib/jgo/import` внутри контейнера (`pct push` / `scp`) или загружайте игры из браузера.
* Скрипт отказывается подключать `/`, `/etc`, `/root`, `/boot`, `/proc`, `/sys`, `/dev`, пути со пробелами/запятыми и символические ссылки.

Подробнее об импорте, дублях и MobyGames — [LIBRARY.md](LIBRARY.md).

## Команда `jgo`

| Команда | Что делает |
|---|---|
| `jgo status [--json]` | версия, службы, адрес, health, размер данных, последний бэкап |
| `jgo update [--check] [--to vX] [--yes]` | обновление (см. выше); `--check` возвращает код 10, если есть новая версия |
| `jgo backup [--out PATH] [--no-games] [--stop]` | архив `.tar.gz` (`0600`) с контрольными суммами; без остановки службы (SQLite — `VACUUM INTO`) |
| `jgo restore FILE [--yes] [--with-config] [--only db,saves,games,settings,metadata,config]` | проверка архива, страховочная копия текущего состояния, откат при неудаче |
| `jgo rollback` | вернуть предыдущий релиз |
| `jgo logs [-f] [-n N]` | журнал `jgo` и `jgo-xvfb` (`journalctl`) |
| `jgo doctor [--online]` | проверка системы, установки, службы, песочницы, лимитов, доступа и бэкапов; код 1 при ошибках |
| `jgo token [--rotate]` | показать / заменить токен |
| `jgo network [deny\|allow\|status]` | сеть игр: `deny` (по умолчанию) или `allow` |
| `jgo library [status]` | папки библиотеки: подключены ли, читает ли их служба, сколько JAR |

## Настройка

`/etc/jgo/jgo.env` (после правки: `systemctl restart jgo`). Основное: `PORT`, `HOST` (`127.0.0.1`, если JGO стоит за прокси в том же контейнере),
`MAX_SESSIONS` (по умолчанию 1: один эмулятор ≈ 0,25–0,5 ГБ и ядро CPU), `SESSION_MAX_MINUTES`, `SESSION_IDLE_MINUTES`, `MAX_UPLOAD_MB`, `LIBRARY_QUOTA_MB`,
`FRAME_ENCODING` (`deflate` экономит трафик в LAN/VPN), `KEM_JVM_ARGS`, `KEM_LAUNCH_WRAPPER`. Полный список с комментариями — `/opt/jgo/share/jgo.env.example`.

Лимиты cgroup меняются drop-in'ом, который не затирается обновлением:

```bash
systemctl edit jgo      # [Service]\nMemoryMax=2G\nCPUQuota=200%
```

## Диагностика

```bash
jgo doctor                       # что не так и как исправить
jgo logs -n 100                  # журнал служб
journalctl -u jgo -f             # в реальном времени
jgo status
```

| Симптом | Причина / решение |
|---|---|
| `jgo doctor`: «network isolation is configured but unshare fails» | у контейнера выключен `nesting`: Proxmox → контейнер → Options → Features → Nesting, либо `jgo network allow` |
| M3G-игра не рисует, в логе `GL`/`display` | `systemctl status jgo-xvfb`; `jgo doctor` проверяет наличие Mesa swrast |
| Нет звука в браузере | звук включается жестом пользователя (нажмите на игру); при доступе по `http://IP` веб-аудио работает через `ScriptProcessorNode` (AudioWorklet требует HTTPS) |
| Страница входа просит токен | `jgo token` |
| `update`: «release … has no jgo-*-linux-amd64.tar.gz + SHA256SUMS» | релиз ещё собирается (workflow `Release`) |

## Проверка установки

`tests/lxc/run.sh` устанавливает JGO **настоящим** `install/jgo-install.sh` (с движком Community Scripts на коммите из `tests/lxc/core.pin`)
в системный контейнер Debian 13 с systemd и прогоняет сценарии: установка и права, токен-аутентификация, 2D, звук, M3G на llvmpipe, песочница
(процессы, capabilities, сетевое пространство имён, лимиты cgroup, файловая система службы), RMS через перезапуск службы и контейнера, бэкап и восстановление,
перенос в новый контейнер, обновление через `ct/jgo.sh`, откат релиза, который не стартует, отказ от подменённого архива.
GitHub подменяется локальным TLS-сервером (`tests/lxc/fake-github.mjs`): движок и `jgo update` ходят в него без изменений. В CI те же сценарии идут в
непривилегированном LXC (`BACKEND=lxd tests/lxc/run.sh`, job `lxc-real`).

```bash
tests/lxc/run.sh                       # Docker + root; на хосте с egress-прокси: DOCKER_NET=host BASE_IMAGE=<зеркало debian:trixie>; ~15 минут
ONLY="install functional" tests/lxc/run.sh
```

**Не проверено:** установка на живом Proxmox VE (создание контейнера `pct`, мастер Advanced, шаблон Debian 13 от Proxmox).
Эта часть — код движка Community Scripts, не JGO; до первого прогона на реальном узле считайте её непроверенной.

## Community Scripts

В репозитории: `ct/jgo.sh`, `install/jgo-install.sh`, `json/jgo.json` — в формате DevScripts. Для pull request в
`community-scripts/DevScripts` есть заготовка (**ничего не публикуется автоматически**):

```bash
packaging/devscripts/lint.sh        # проверка правил AGENTS.md, которые проверяются механически
packaging/devscripts/export.sh      # dist-devscripts/{ct,install,json}/ + PR.md с заполненным описанием
```

Осознанные отступления от правил DevScripts и причины — в [`packaging/devscripts/DEVIATIONS.md`](../packaging/devscripts/DEVIATIONS.md).
