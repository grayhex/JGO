# Резервное копирование, восстановление и перенос MGO

Данные MGO — это `/var/lib/mgo` (SQLite-библиотека с настройками игр и результатами импорта, файлы игр, **RMS-сохранения**, `settings.json`, **`secrets.json` с ключом MobyGames**, `metadata/` с обложками) и `/etc/mgo/mgo.env` (настройки и токен).
Приложение в `/opt/mgo` восстанавливается переустановкой/обновлением и в копии не нуждается.
Есть два независимых уровня защиты; лучше иметь оба.

| Уровень | Чем | Что защищает | Восстановление |
|---|---|---|---|
| Контейнер целиком | Proxmox `vzdump` → **Proxmox Backup Server (PBS)** | всё: ОС, приложение, данные, токен | `pct restore` / восстановление из PBS, ~минуты |
| Данные MGO | `mgo backup` | библиотека, игры, RMS, настройки веб-интерфейса, ключ и данные MobyGames, конфигурация (файл `.tar.gz` на 1–несколько ГБ) | `mgo restore`, перенос в другой контейнер |

## 1. Резервное копирование контейнера в Proxmox Backup Server

Предполагается, что PBS уже подключён как хранилище (Datacenter → Storage → Add → Proxmox Backup Server).

**Разовая копия:** Datacenter → Backup → *Backup now* (или в оболочке узла):

```bash
vzdump <CTID> --storage <pbs-storage> --mode snapshot --compress zstd
```

**По расписанию:** Datacenter → Backup → Add. Выберите контейнер MGO, хранилище PBS, режим **Snapshot**, расписание (например, ежедневно в 03:00),
политику хранения (`keep-daily=7, keep-weekly=4, keep-monthly=6` — настраивается и в PBS через *Prune*).

Замечания:

* **Snapshot-режим не останавливает контейнер.** Для него нужен storage с поддержкой снимков (ZFS, LVM-thin, Ceph, qcow2 на директории — не «голая» директория
  с raw). Если снимки недоступны, используйте режим *Stop* (контейнер на минуту остановится) — службы MGO корректно завершат сессии и закроют SQLite.
* SQLite работает в режиме WAL. Снимок файловой системы «на лету» согласован на уровне файловой системы, а SQLite при следующем старте
  сам доиграет WAL, поэтому восстановленная копия поднимается без ручных действий. Если нужна гарантия «без потерь последней минуты» — режим *Stop*
  или копия `mgo backup` (она делает `VACUUM INTO`, консистентный снимок).
* Защита от случайного удаления: у контейнера включите *Protection* (Options → Protection), тогда его нельзя удалить или перезаписать при восстановлении, пока флаг стоит.
* Шифрование на стороне клиента PBS (ключ шифрования) защищает токен доступа, который лежит в копии.

### Восстановление контейнера из PBS

GUI: хранилище PBS → *Backups* → выбрать копию → *Restore* (укажите новый CTID, если исходный ещё существует). CLI:

```bash
pct restore <новый-CTID> <pbs-storage>:backup/ct/<CTID>/<время> --storage <local-lvm> --unprivileged 1
pct start <новый-CTID>
pct exec <новый-CTID> -- mgo doctor
```

**Файл или папка из копии** (например, только `saves/`): PBS → *Backups* → *File Restore* (скачать нужные файлы), либо `proxmox-backup-client` / `pct restore` во временный контейнер
и `mgo restore --only saves` ниже.

После восстановления контейнера на другом узле проверьте адрес: если IP выдаётся по DHCP, он мог измениться — `mgo status`.

## 2. Резервная копия данных MGO (`mgo backup`)

```bash
mgo backup                        # → /var/backups/mgo/mgo-<хост>-<версия>-<время>.tar.gz   (хранится 7 последних)
mgo backup --out /mnt/nas/        # другой каталог, или конкретный файл *.tar.gz
mgo backup --no-games             # без загруженных JAR (быстро: библиотека + RMS + конфигурация)
mgo backup --stop                 # остановить MGO на время копирования (абсолютная согласованность)
```

Внутри: `data/library.sqlite` (консистентный снимок), `data/saves/` (RMS), `data/games/`, `etc/mgo.env`, `meta.json`, `SHA256SUMS`. Файл создаётся с правами `0600`:
**в нём токен доступа** — храните как секрет. Автоматически копия делается перед каждым обновлением (`pre-update-…`) и перед каждым восстановлением (`pre-restore`).

Расписание внутри контейнера (cron/systemd timer), если не хотите полагаться только на vzdump:

```bash
cat >/etc/systemd/system/mgo-backup.service <<'EOF'
[Unit]
Description=MGO data backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/mgo backup --no-games
EOF
cat >/etc/systemd/system/mgo-backup.timer <<'EOF'
[Unit]
Description=Nightly MGO data backup
[Timer]
OnCalendar=*-*-* 03:30
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now mgo-backup.timer
```

Копия внутри того же контейнера не защищает от потери контейнера: периодически забирайте её наружу (`pct pull <CTID> /var/backups/mgo/<файл> .` на узле) или монтируйте общий каталог.

## 3. Восстановление данных (`mgo restore`)

```bash
mgo restore /var/backups/mgo/mgo-….tar.gz            # спросит подтверждение; --yes — без вопроса
mgo restore FILE --only saves                         # только RMS-сохранения  (db, saves, games, config)
mgo restore FILE --with-config                        # вместе с mgo.env (токен и настройки из копии)
```

Что происходит: проверка путей в архиве и **контрольных сумм** (повреждённый файл отвергается до любых изменений) → страховочная копия текущего состояния
(`pre-restore`) → остановка → замена данных → запуск → проверка `/api/health`. Если MGO не поднялся, команда возвращает прежние данные из страховочной копии.
По умолчанию конфигурация (`mgo.env`) **не** перезаписывается — токен и порт этого контейнера остаются; `--with-config` берёт их из копии.

Типичные случаи:

| Ситуация | Действие |
|---|---|
| Случайно удалена игра / повреждена библиотека | `mgo restore FILE --only db,games` |
| Потеряны сохранения одной игры | `mgo restore FILE --only saves` (заменяет все `saves/`; текущие уже сохранены в `pre-restore`) |
| Сломалось обновление | оно откатывается само; ручной вариант: `mgo rollback` (приложение) и `mgo restore <pre-update-…> --only db,saves` (данные) |
| Контейнер потерян полностью | восстановить из PBS (раздел 1) или перенос ниже |

## 4. Перенос MGO в другой контейнер / на другой узел

**Вариант A — перенос контейнера целиком** (тот же кластер или через PBS): `pct migrate <CTID> <узел>` (с остановкой для LXC), либо копия в PBS и `pct restore` на новом узле
(раздел 1). Токен, данные и версия переезжают как есть.

**Вариант B — чистая установка + перенос данных** (другая версия Proxmox, другой тип хранилища, «переехать на свежий Debian»):

```bash
# 1. на старом контейнере
mgo backup --out /root/mgo-move.tar.gz --stop
pct pull <OLD_CTID> /root/mgo-move.tar.gz /root/mgo-move.tar.gz      # на узле Proxmox

# 2. новый контейнер той же командой установки (раздел «Установка» в PROXMOX.md); дождитесь «MGO answers on port 8080»

# 3. на новом
pct push <NEW_CTID> /root/mgo-move.tar.gz /root/mgo-move.tar.gz
pct exec <NEW_CTID> -- mgo restore /root/mgo-move.tar.gz --yes --with-config
pct exec <NEW_CTID> -- mgo doctor
```

`--with-config` переносит и токен: браузеры, где вы уже входили, продолжат работать. Без него у нового контейнера останется свой токен (`mgo token`).
Версии: восстанавливать копию в **ту же или более новую** версию MGO. Копия более новой версии в старую может не открыться (схема SQLite) — сначала `mgo update`.
Проверено автотестом `tests/lxc/run.sh` (сценарий *migrate*): копия из контейнера A восстановлена во вторую установку, игры, RMS и токен совпали.

## 5. Проверка копий

Копия, которую ни разу не восстанавливали, — не копия. Раз в квартал: восстановите последнюю копию PBS в **новый** CTID без сети (`pct restore … ; pct set <id> -net0 …` отключить),
запустите, выполните `pct exec <id> -- mgo doctor` и убедитесь, что `mgo status` показывает ваши игры; для файлов `mgo backup` — `tar -tzf FILE | head` и `mgo restore FILE --only saves` в тестовый контейнер.

> Архивы `mgo backup` и снимки контейнера содержат ключ MobyGames (`secrets.json`). Храните их как секрет (архивы создаются с правами `0600`). Папка с играми на хосте в архив не входит: это ваш исходный каталог; импортированные из неё игры уже скопированы в библиотеку MGO.
