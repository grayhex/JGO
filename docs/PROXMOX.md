# MGO в Proxmox VE (LXC, без Docker) — дополнительный способ

Основной способ запуска MGO — Docker ([DOCKER.md](DOCKER.md)): готовый образ, подходит для NAS и серверов. Этот документ — для тех, у кого есть Proxmox VE
и кто хочет отдельный непривилегированный LXC-контейнер Debian 13, созданный скриптом в формате [Community Scripts](https://community-scripts.org/).
Всё работает нативно: `systemd`, пользователь `mgo`, без Docker; обновления и резервные копии делает команда `mgo`.

## Установка одной командой

В оболочке **хоста Proxmox VE** (Datacenter → узел → Shell), от root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/grayhex/MGO/main/ct/mgo.sh)"
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
затем **релиз MGO** (`mgo-<версия>-linux-amd64.tar.gz` из GitHub Releases): API и веб-интерфейс, Bridge-супервизор на Rust,
KEmulator nnmod (собран в CI из закреплённого коммита с патчами из `runtime/patches`), CLI `mgo`.

> Релиз появляется, когда в репозитории поставлен тег `v<версия>` (workflow `Release`). Пока релизов нет, скрипт установки остановится
> на шаге загрузки: сначала нужно выпустить релиз (`git tag v0.1.0-beta.1 && git push origin v0.1.0-beta.1`).

## Раскладка

| Путь | Содержимое | Владелец |
|---|---|---|
| `/opt/mgo` | приложение (релиз): `app/`, `kemulator/`, `bin/mgo`, `bin/kem-adapter`, `share/` | `root`, для `mgo` только чтение |
| `/opt/mgo.prev` | предыдущий релиз после обновления (для `mgo rollback`) | `root` |
| `/var/lib/mgo` | **все данные**: `library.sqlite` (игры, настройки), `games/`, `saves/` (RMS), `logs/` | `mgo:mgo`, `0700` |
| `/etc/mgo/mgo.env` | конфигурация и токен доступа | `root:mgo`, `0640` |
| `/var/backups/mgo` | архивы `mgo backup` (перед обновлением и восстановлением — автоматически) | `root`, `0700` |
| `/etc/systemd/system/mgo.service`, `mgo-xvfb.service` | службы | `root` |
| `/usr/local/bin/mgo` | ссылка на `/opt/mgo/bin/mgo` | |

Службы: `mgo-xvfb` (виртуальный дисплей `:99`) и `mgo` (API, веб, сессии эмулятора). Оба включены в автозапуск; `Restart=on-failure`.

## Безопасность

JAR — недоверенный код. Слои защиты (проверяются `mgo doctor` и `tests/lxc/run.sh`):

* **Не публикуйте порт 8080 в интернет.** Сервис слушает `0.0.0.0` внутри контейнера и не стартует без токена (`AUTH_TOKEN` ≥ 16 символов),
  но это защита домашней/корпоративной сети, не публичного хостинга: нет TLS, нет ограничения попыток входа. Для доступа извне —
  VPN (WireGuard, Tailscale) или обратный прокси с TLS и внешней аутентификацией; в `ALLOWED_ORIGINS` добавьте адрес прокси.
* **Токен** генерируется при установке (`random_password`, 32 символа), лежит только в `/etc/mgo/mgo.env` (`0640 root:mgo`).
  `mgo token` показывает, `mgo token --rotate` заменяет (все сессии браузера разлогиниваются).
* **Пользователь `mgo`**: системный, без оболочки, без capabilities, `NoNewPrivileges`. Приложение в `/opt/mgo` ему доступно только на чтение.
* **Песочница systemd** (`mgo.service`): `ProtectSystem=strict` (записать можно только `/var/lib/mgo`), `ProtectHome`, `PrivateTmp`,
  `PrivateDevices`, `NoExecPaths=/var/lib/mgo` (загруженное не исполняется), `ProtectKernel*`, `ProtectControlGroups`, `RestrictNamespaces=user net`,
  `RestrictAddressFamilies`, `SystemCallFilter=@system-service` без `@privileged` (`@resources` разрешён: без него падает программный OpenGL, найдено тестом M3G), пустой `CapabilityBoundingSet`.
  `MemoryDenyWriteExecute` выключен: JIT-компилятору JVM нужны страницы W+X.
* **Лимиты cgroup** на всё, что запускает служба (API и JVM игр): `MemoryHigh=2560M`, `MemoryMax=3G`, `MemorySwapMax=0`, `TasksMax=1024`,
  `CPUQuota=300%`, `LimitNOFILE=8192`, `LimitCORE=0`, `OOMPolicy=stop`; у `mgo-xvfb` — `MemoryMax=256M`, `TasksMax=32`. Для JVM дополнительно
  `-Xmx768m -XX:MaxMetaspaceSize=192m -XX:MaxDirectMemorySize=128m -XX:+ExitOnOutOfMemoryError` (`KEM_JVM_ARGS`) и `RLIMIT_CORE=0`, `RLIMIT_FSIZE`
  от супервизора. Лимиты контейнера (4 ГБ, 4 ядра) действуют сверху.
* **Сеть игр**: каждая JVM запускается в своём сетевом пространстве имён (`unshare --user --map-current-user --net`, `KEM_LAUNCH_WRAPPER`):
  у игры нет интерфейсов, кроме `lo`, она не видит ни интернет, ни вашу LAN. Это требует `nesting=1` у контейнера. Без него
  `mgo doctor` сообщит об ошибке; тогда `mgo network allow` (игры получают сеть контейнера) и закройте исходящий трафик **файрволом Proxmox**
  (`Container → Firewall`: политика `OUT DROP`, разрешить DNS и нужные вам хосты).
* **Обработка JAR** (код `apps/api/src/jar.ts`, ничего не исполняется при загрузке): лимит размера и квота библиотеки, запрет `..`, `/`, `\` в именах записей,
  лимиты числа записей и суммарного распакованного размера (zip-bomb), имя файла клиента не используется, дедупликация по SHA-256.
* **Окружение JVM** очищено (в нём нет `AUTH_TOKEN`), игра пишет RMS только в свою папку `saves/<владелец>/<игра>`.

Что **не** сделано: нет TLS в самом сервисе, нет ограничения частоты запросов, одна учётная запись (`default`). Подробнее — [SECURITY.md](SECURITY.md).

## Обновление

Внутри контейнера работает стандартная команда Community Scripts **`update`**, она вызывает `update_script()` из `ct/mgo.sh`:
проверяет последний релиз (`check_for_gh_release`) и запускает **`mgo update`**. Можно и напрямую: `mgo update`, `mgo update --check`, `mgo update --to v0.3.0`.

Порядок `mgo update` (код — `packaging/bin/mgo`, проверен в `tests/lxc/run.sh`):

1. релиз скачивается, **SHA-256 сверяется с `SHA256SUMS`**; пути в архиве проверяются (`..`, абсолютные, ссылки за пределы дерева, специальные файлы). Любая ошибка — до остановки службы;
2. **резервная копия** (`mgo backup`, метка `pre-update-<версия>`): консистентный снимок SQLite, `saves/`, `games/`, конфигурация;
3. остановка служб, новое дерево кладётся рядом (`/opt/mgo.new`) и подменяется переименованием; старое остаётся в `/opt/mgo.prev`;
4. обновляются unit-файлы и **добавляются новые ключи** в `mgo.env` (существующие значения не трогаются);
5. запуск и **проверка**: `/api/health` должен ответить `ok` **и назвать новую версию** (до `MGO_HEALTH_WAIT`=60 с);
6. при неудаче — **автоматический откат**: прежнее дерево и конфигурация возвращаются, SQLite и RMS восстанавливаются из снимка шага 2
   (новая версия могла изменить схему), служба стартует снова; команда завершается с ошибкой.

`mgo rollback` вручную возвращает предыдущий релиз (дерево `/opt/mgo.prev`). Данные при этом не откатываются — для них `mgo restore`.

## Библиотека игр с хоста (read-only bind mount)

Коллекцию JAR/JAD можно оставить на хосте Proxmox и подключить к контейнеру **только для чтения**. MGO ничего там не пишет, не переносит и не удаляет: при импорте он копирует *новые* игры в собственную библиотеку (`/var/lib/mgo`).

```bash
# на хосте Proxmox, от root; CTID — номер контейнера MGO
tools/proxmox/mgo-library-mount.sh <CTID> /path/on/host/games      # добавит mp<N>: ...,mp=/mnt/mgo-library,ro=1 и перезапустит контейнер
tools/proxmox/mgo-library-mount.sh <CTID> --remove                   # убрать
```

Либо сразу при создании контейнера: `var_library_path=/path/on/host/games bash -c "$(curl -fsSL https://raw.githubusercontent.com/grayhex/MGO/main/ct/mgo.sh)"`.
То же вручную: `pct set <CTID> -mp0 /path/on/host/games,mp=/mnt/mgo-library,ro=1 && pct reboot <CTID>`.

Затем в MGO: **Settings → Game library** (или мастер первого запуска) → выбрать `/mnt/mgo-library` → *Check access* → *Use this folder* → *Scan library folder*.

* **Права в непривилегированном контейнере.** Пользователи контейнера отображаются на хосте как `100000+uid`, поэтому файлы должны читаться «остальными» (`chmod -R o+rX /path/on/host/games`) либо надо выдать ACL для `100000+uid` пользователя `mgo` (`pct exec <CTID> -- id -u mgo`). Скрипт предупреждает, если у каталога нет прав `o+rx`; `mgo library` и `mgo doctor` показывают, читает ли каталог служба.
* **Куда можно указывать.** Только в разрешённые каталоги: `/mnt/mgo-library`, `/srv/mgo-library` и `/var/lib/mgo/import` (список задаёт `LIBRARY_ROOTS` в `/etc/mgo/mgo.env`). Веб-интерфейс и API не читают ничего за их пределами; символические ссылки не разыменовываются.
* **Без bind mount**: скопируйте файлы в `/var/lib/mgo/import` внутри контейнера (`pct push` / `scp`) или загружайте игры из браузера.
* Скрипт отказывается подключать `/`, `/etc`, `/root`, `/boot`, `/proc`, `/sys`, `/dev`, пути со пробелами/запятыми и символические ссылки.

Подробнее об импорте, дублях и MobyGames — [LIBRARY.md](LIBRARY.md).

## Команда `mgo`

| Команда | Что делает |
|---|---|
| `mgo status [--json]` | версия, службы, адрес, health, размер данных, последний бэкап |
| `mgo update [--check] [--to vX] [--yes]` | обновление (см. выше); `--check` возвращает код 10, если есть новая версия |
| `mgo backup [--out PATH] [--no-games] [--stop]` | архив `.tar.gz` (`0600`) с контрольными суммами; без остановки службы (SQLite — `VACUUM INTO`) |
| `mgo restore FILE [--yes] [--with-config] [--only db,saves,games,settings,metadata,config]` | проверка архива, страховочная копия текущего состояния, откат при неудаче |
| `mgo rollback` | вернуть предыдущий релиз |
| `mgo logs [-f] [-n N]` | журнал `mgo` и `mgo-xvfb` (`journalctl`) |
| `mgo doctor [--online]` | проверка системы, установки, службы, песочницы, лимитов, доступа и бэкапов; код 1 при ошибках |
| `mgo token [--rotate]` | показать / заменить токен |
| `mgo network [deny\|allow\|status]` | сеть игр: `deny` (по умолчанию) или `allow` |
| `mgo library [status]` | папки библиотеки: подключены ли, читает ли их служба, сколько JAR |

## Настройка

`/etc/mgo/mgo.env` (после правки: `systemctl restart mgo`). Основное: `PORT`, `HOST` (`127.0.0.1`, если MGO стоит за прокси в том же контейнере),
`MAX_SESSIONS` (по умолчанию 1: один эмулятор ≈ 0,25–0,5 ГБ и ядро CPU), `SESSION_MAX_MINUTES`, `SESSION_IDLE_MINUTES`, `MAX_UPLOAD_MB`, `LIBRARY_QUOTA_MB`,
`FRAME_ENCODING` (`deflate` экономит трафик в LAN/VPN), `KEM_JVM_ARGS`, `KEM_LAUNCH_WRAPPER`. Полный список с комментариями — `/opt/mgo/share/mgo.env.example`.

Лимиты cgroup меняются drop-in'ом, который не затирается обновлением:

```bash
systemctl edit mgo      # [Service]\nMemoryMax=2G\nCPUQuota=200%
```

## Диагностика

```bash
mgo doctor                       # что не так и как исправить
mgo logs -n 100                  # журнал служб
journalctl -u mgo -f             # в реальном времени
mgo status
```

| Симптом | Причина / решение |
|---|---|
| `mgo doctor`: «network isolation is configured but unshare fails» | у контейнера выключен `nesting`: Proxmox → контейнер → Options → Features → Nesting, либо `mgo network allow` |
| M3G-игра не рисует, в логе `GL`/`display` | `systemctl status mgo-xvfb`; `mgo doctor` проверяет наличие Mesa swrast |
| Нет звука в браузере | звук включается жестом пользователя (нажмите на игру); при доступе по `http://IP` веб-аудио работает через `ScriptProcessorNode` (AudioWorklet требует HTTPS) |
| Страница входа просит токен | `mgo token` |
| `update`: «release … has no mgo-*-linux-amd64.tar.gz + SHA256SUMS» | релиз ещё собирается (workflow `Release`) |

## Проверка установки

`tests/lxc/run.sh` устанавливает MGO **настоящим** `install/mgo-install.sh` (с движком Community Scripts на коммите из `tests/lxc/core.pin`)
в системный контейнер Debian 13 с systemd и прогоняет сценарии: установка и права, токен-аутентификация, 2D, звук, M3G на llvmpipe, песочница
(процессы, capabilities, сетевое пространство имён, лимиты cgroup, файловая система службы), RMS через перезапуск службы и контейнера, бэкап и восстановление,
перенос в новый контейнер, обновление через `ct/mgo.sh`, откат релиза, который не стартует, отказ от подменённого архива.
GitHub подменяется локальным TLS-сервером (`tests/lxc/fake-github.mjs`): движок и `mgo update` ходят в него без изменений. В CI те же сценарии идут в
непривилегированном LXC (`BACKEND=lxd tests/lxc/run.sh`, job `lxc-real`).

```bash
tests/lxc/run.sh                       # Docker + root; на хосте с egress-прокси: DOCKER_NET=host BASE_IMAGE=<зеркало debian:trixie>; ~15 минут
ONLY="install functional" tests/lxc/run.sh
```

**Не проверено:** установка на живом Proxmox VE (создание контейнера `pct`, мастер Advanced, шаблон Debian 13 от Proxmox).
Эта часть — код движка Community Scripts, не MGO; до первого прогона на реальном узле считайте её непроверенной.

## Community Scripts

В репозитории: `ct/mgo.sh`, `install/mgo-install.sh`, `json/mgo.json` — в формате DevScripts. Для pull request в
`community-scripts/DevScripts` есть заготовка (**ничего не публикуется автоматически**):

```bash
packaging/devscripts/lint.sh        # проверка правил AGENTS.md, которые проверяются механически
packaging/devscripts/export.sh      # dist-devscripts/{ct,install,json}/ + PR.md с заполненным описанием
```

Осознанные отступления от правил DevScripts и причины — в [`packaging/devscripts/DEVIATIONS.md`](../packaging/devscripts/DEVIATIONS.md).
