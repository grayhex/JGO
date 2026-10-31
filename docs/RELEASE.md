# Выпуск релиза и готовность первой беты

## Как выпустить

1. Версия во всех `package.json`, в `bridge/kemulator-adapter/Cargo.toml` и `Cargo.lock` совпадает с тегом (`0.1.0-beta.1`); запись в [CHANGELOG.md](../CHANGELOG.md) готова.
2. Проверка без публикации: Actions → **Release** → *Run workflow* с нужной версией. Собирает тарболл и оба образа, ничего не публикует; артефакты можно скачать и посмотреть.
3. Тег: `git tag v0.1.0-beta.1 && git push origin v0.1.0-beta.1`. Workflow **Release**:
   * публикует образы `ghcr.io/grayhex/jgo:<версия>` и `ghcr.io/grayhex/jgo-gateway:<версия>` (и `:latest`, кроме `-alpha`/`-rc`/`-dev`);
   * создаёт GitHub Release с `compose.yaml`, `compose.egress.yaml`, `env.example`, тарболлом для Proxmox (`jgo-<версия>-linux-amd64.tar.gz`), `SHA256SUMS` и исходниками KEmulator (лицензии GPL/Apache/EPL).
4. **Один раз** после первой публикации: GitHub → профиль → *Packages* → `jgo` и `jgo-gateway` → *Package settings* → *Change visibility* → **Public**. Пока пакеты приватны, NAS не сможет скачать образ.
5. Проверка установки «с нуля» по [DOCKER.md](DOCKER.md) на чистой машине, затем — на реальном NAS.

Теги `-alpha`, `-rc`, `-dev` помечаются как pre-release (Community Scripts и `latest` их пропускают); `-beta` — обычный релиз, чтобы `latest` указывал на него и скрипт Proxmox мог его установить.

## Готовность первой беты

Проверено автоматически (CI на каждый PR, настоящий KEmulator):

| Область | Чем подтверждено |
|---|---|
| Игры идут: 2D, звук, M3G, RMS, ввод, пауза, скорость, файлы, SoundFont | интеграционные и e2e-тесты (`npm run test:integration`, `npm run test:e2e`) |
| Контракт Bridge | `tests/integration/bridge-contract.test.ts` |
| Docker: сборка, запуск, токен обязателен, игры без сети, не root, read-only, папка данных другого пользователя (PUID/PGID), данные переживают перезапуск | job `docker` в `ci.yml` |
| Proxmox: установка, песочница, обновление и откат, резервные копии | jobs `install` и `lxc` |
| Порядок версий `jgo update` (beta < релиз) | `tests/scripts/version-order.test.sh` |
| Границы production и dev | `tests/scripts/production.mjs` |

**Не проверено (риски беты):**

* настоящие NAS Synology/UGREEN: пункты меню Container Manager/UGOS, права на общие папки, поведение `.env` в проектах;
* процессоры ARM (образы только `linux/amd64`);
* публикация образа в GHCR (первый запуск workflow `Release` на теге);
* коммерческие игры: вручную смотрели считанные единицы; Mascot Capsule с `.mbac`, видео и настоящий AMR не проверены;
* нагрузка: больше одной одновременной игры на слабом NAS (по умолчанию `MAX_SESSIONS=1`);
* HTTPS и обратный прокси: описано в [DOCKER.md](DOCKER.md), но не прогонялось.

Что просить у бета-тестеров: версию, модель NAS и процессор, название игры, диагностику (*Session → Download diagnostics*) — это поля шаблона ошибки.
