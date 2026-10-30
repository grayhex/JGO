# KEmulator nnmod v2.22 → JGO: матрица возможностей

Технический аудит: что умеет эмулятор, что из этого доходит до пользователя JGO и что нет. Предмет аудита — KEmulator nnmod v2.22,
commit `9ec1005af5448bca63a420e1dfa884ef53842d0f` (исходники: `src/main/emulator/…`, `BridgeFrontendDocs.md`), с патчами `runtime/patches/0001…0009` (состояние на момент аудита; что добавлено после — в разделе 9)
и слои JGO: Rust-адаптер → Node API → React UI → тесты.

## Как читать

Каждое утверждение помечено способом проверки:

| Метка | Значение |
|---|---|
| **[S]** | прочитан исходный код KEmulator `9ec1005` (`файл:строка` — по стоковым исходникам, до патчей JGO) или код JGO |
| **[R]** | выполнено на настоящем эмуляторе через `tools/audit/probe.mjs`; результат сохранён в `tools/audit/results.json` |
| **[T]** | покрыто существующим автотестом репозитория |
| **[D]** | взято из документации; своим запуском не подтверждено |

Воспроизведение (после `npm run build`, `npm run fixtures:dev`):

```bash
bash tools/audit/build.sh                  # пробные MIDlet и ассеты (нужны javac, ffmpeg, python3)
node tools/audit/probe.mjs                 # все сценарии: inputs packets textfield media apis soundfont
node tools/audit/probe.mjs media apis      # или выборочно; результаты пишутся в tools/audit/results.json
```

Пробы не содержат чужих материалов: MIDlet — CC0, MP3/WAV/MIDI/PNG генерируются, AMR — **синтетический** битовый поток (проверяет путь декодера, а не качество звука).

Классы выводов (раздел 7): **дефект** — подтверждённая ошибка; **нет функции** — ядро умеет, JGO не показывает; **не подтверждено** — запускалось не всё нужное; **ограничение ядра** — KEmulator этого не делает в Bridge-режиме.

---

## 1. Протокол Bridge: входящие события (клиент → эмулятор, `inputpipe`)

Обработчик — `BridgeInput.handleEvent` (`src/main/emulator/ui/bridge/BridgeInput.java`). Адаптер Rust пересылает строку `I` в FIFO без разбора (`bridge/kemulator-adapter/src/main.rs:463`); Node формирует строки сам (`apps/api/src/kemulator/adapter.ts`), поэтому некорректную строку интерфейс породить не может.

| Пакет | Ядро (KEmulator) | Rust-адаптер | Node API | React UI | Тест | Итог |
|---|---|---|---|---|---|---|
| `K D/R/U <код>` | `BridgeInput.java:47` → `EventQueue.keyPress/keyRepeat/keyRelease` **[S]** | passthrough `I` (`main.rs:463`) | `adapter.ts` `keyDown:283` (повтор → `K R`), `keyUp:292`, `releaseAll:298`; `sessions.ts` `handleClientEvent:298` (ref-count по зрителям) | клавиатура, Keypad, PhoneSkin, геймпад (`input.ts`) | `tests/e2e/browser.mjs`, `tests/integration/api.test.ts`; **[R]** `inputs`: `KEY_DOWN 53` дошёл | работает |
| `T <id> D/M/U <x> <y>` | `BridgeInput.java:64` → `mouseDown/mouseDrag/mouseUp` **[S]** | passthrough | `pointerEvent:302`; `sessions.ts` ограничивает id `& 7` и координаты | `Player.tsx` `pointer:317` (с учётом поворота картинки) | `bridge-regressions.test.ts:116`, `tests/e2e/orientation.mjs`; **[R]** `POINTER_DOWN 100,100` | работает; `hasPointerEvents()` = true по умолчанию (`AppSettings.java:131`, **[R]** `apis`) |
| `C <id>` | `BridgeInput.java:83` → `commandsCache.get(id).invoke()` **[S]** | passthrough | `invokeCommand:307`; событие `cmd` | модальное меню команд в `Player.tsx` (событие `menu`) | `bridge-regressions.test.ts:97`; **[R]** неизвестный id → `IllegalArgumentException`, сессия жива | работает |
| `P <id> 0/1` | `BridgeInput.java:91` → `PermissionWaitData.resolve` **[S]** | passthrough | `answerPermission:311`; таймаут и «нет зрителей — отказ» в `sessions.ts` | окно «Permission request» (`Player.tsx:573`) | `bridge-regressions.test.ts:131,144` | работает |
| `X <0/1>` | `BridgeInput.java:113` → `AppSettings.xrayView` **[S]** | passthrough | **нет** метода | **нет** | **[R]** `X 1`/`X 0` принимаются; `X 2` → `IllegalArgumentException` | **ограничение ядра**: режим включается, но `BridgeOutput.sendBuffer:102-103` всегда копирует `screenImageAwt`, строка с x-ray закомментирована **[S]** → картинка не меняется. JGO правильно ничего не предлагает (issue I-09) |
| `E …` (текст) | `BridgeInput.java:110` → `RuntimeException("Not implemented")` **[S]**; в спецификации «WIP» | — | **нет** | **нет** | **[R]** `E hello` → `Not implemented`, сессия жива | **ограничение ядра** → ввод текста невозможен (I-01) |
| `I` (резерв) | `BridgeInput.java:107` → `Not implemented` **[S]** | — | — | — | **[R]** то же | не используется |
| неизвестный / битый | `BridgeInput.java:118` `IllegalArgumentException`; битый `K D` → `ArrayIndexOutOfBounds`, `K D abc` → `NumberFormatException`; цикл ловит `RuntimeException` (`BridgeInput.run`) **[S]** | — | — | — | **[R]** `Z 1`, `S 2`, `K D`, `K D abc`, `P 12345 1` — исключение в логе, кадры продолжают идти | устойчиво |
| `Q` (расширение JGO) | патч `0009` → `MIDlet.invokeDestroyApp(true)` + `System.exit(0)` | `main.rs:473` `request_quit` (закрытие `inputpipe`, SIGKILL через `--grace-ms`, 8 с по умолчанию) | `adapter.ts` `stop:316` | кнопки Stop/Restart | `tests/integration/reliability.test.ts`, `tests/e2e/recovery.mjs` | работает (в спецификации Bridge такой команды нет) |

Пауза, шаг, speed, suspend/resume **во входящем протоколе отсутствуют** → раздел 3.

## 2. Протокол Bridge: исходящие пакеты (`statepipe`) и видео

Отправка — `BridgeFrontend.sendToState` (`BridgeFrontend.java:92`). Rust читает пакеты и пересылает их без разбора как `S` (`main.rs:392`); разбирает их только `Session.onStatePacket` (`apps/api/src/sessions.ts:173`).

| Пакет | Откуда в ядре | Node API → событие WS | React UI | Тест / **[R]** | Итог |
|---|---|---|---|---|---|
| `L` лог | `BridgeOutput.showMessage` (`BridgeOutput.java:~200`) **[S]**; stdout/stderr JVM адаптер отдаёт отдельно как свой `L` | `pushLog` | панель «Emulator log» | везде | работает |
| `C` софт-клавиши | `BridgeOutput.sendLabels` (`setLeft/RightSoftLabel`) **[S]** | `softkeys` | `SoftKeys` | `bridge-regressions.test.ts:97`; **[R]** пакеты `C` у всех экранов | работает |
| `M` меню команд | `BridgeFrontend.requestCommandsChoice:107` **[S]**; `BridgeOutput.showCommandsList:145` игнорирует `target` (`//TODO add support for targets`) | разбор id/тип/текст → `menu` | модальное меню | `bridge-regressions.test.ts:97`; **[R]** `M` у `canvas with commands` | работает; команды Item'ов не привязываются к элементу — все попадают в общее меню |
| `O` закрыть меню | `requestCommandsChoice(null)` / `forceCloseCommandsList` **[S]** | `menu-close` | закрывает меню | не вызывался ни тестом, ни пробой | реализовано, не подтверждено запуском |
| `V` вибрация | `startVibra:155` / `stopVibra` (8 нулевых байт) **[S]** | `vibrate` | `navigator.vibrate`, настройка «Vibration» | `bridge-regressions.test.ts:124`; **[R]** `V` у `kemnet` | работает |
| `T` заголовок | `BridgeOutput.updateTitle:246` **[S]** | `title` | заголовок плеера | **[R]** `Settings`, `Pick one`, `Name`, `Notice` | работает |
| `D` экран | `BridgeOutput.setCurrent:234`: в стоке `TextBox`/`List` → `IllegalArgumentException`, иначе `B`; патч `0006` всегда шлёт `B` **[S]** | `displayable` | **игнорируется** (устаревшие предупреждения удалены в этом аудите) | **[R]** во всех 7 экранах только `B` | работает; `T`/`L` возможны только на стоковом эмуляторе |
| `A` область текста | в спецификации есть; **отправителя в ядре нет**: `getCaret()` отдаёт `DummyCaret` (`BridgeOutput.java:167`, `DummyCaret.java`: все методы пусты) **[S]** | пакет попадает в `default:` и отбрасывается | нет | **[R]** 0 пакетов `A` при `Form`+`TextField` | **ограничение ядра** (I-01) |
| `P` разрешение | `BridgeOutput.showSecurityDialog:219` → `PermissionWaitData.request` **[S]** | `permission` + таймаут | окно запроса | `bridge-regressions.test.ts:131,144` | работает |
| `U` URL | в стоке **не отправляется нигде**; патч `0008` — из `Emulator.openUrlExternally` **[S]** | фильтр схем `http(s)/mailto/tel` → `url` | только тост «blocked» (`Player.tsx:175`) | `bridge-regressions.test.ts:131`; **[R]** `U` у `kemnet` | **нет функции**: ссылку нельзя открыть (I-06) |
| `I` иконка | `BridgeOutput.setWindowIcon:177` (патч `0005` — защита от `null`) **[S]** | в `default:` отбрасывается | нет | **[R]** 16×16 RGBA, 1024 байта | не нужен: иконку библиотеки JGO берёт из JAR |
| кадры | `BridgeOutput.repaint:72`, синхронизация `readypipe`/`readpipe` **[S]** | Rust `main.rs:411`, `onFrame` → WS | `canvas` | везде | работает; размер фиксируется при старте (`-screen`) |
| звук (вне спецификации) | `runtime/audio` `WebMixerProvider` → FIFO `audio` | Rust `b'A'` (`main.rs:304`) → `onAudio` → WS `0x02` | `PcmAudio` | `tests/integration/audio.test.ts` | работает (раздел 5) |

## 3. Функции оригинального SWT-интерфейса

Меню `EmulatorScreen.java` (SWT) — единственный пользователь этих функций; во Bridge-режиме `BridgeFrontend` не создаёт ничего из этого, а канала управления нет.

| Функция SWT | Ядро | Команда Bridge | В JGO | Итог |
|---|---|---|---|---|
| Restart / Load JAR | `Emulator.loadGame` (`EmulatorScreen.java:1410`) | — | новая сессия (Restart, библиотека) | заменено эквивалентом |
| **Pause / Step / Resume** | `EmulatorScreen.pause():1303` (`AppSettings.steps=0`), `pauseStep:1307`, `resumeStep` | **нет** | нет | нет функции, нужен патч ядра (I-02) |
| **Suspend / Resume MIDlet** | `EmulatorScreen.java:1455/1466` → `EventQueue.EVENT_PAUSE/EVENT_RESUME` (`pauseApp`/`startApp`) | **нет** | нет; при уходе вкладки в фон игра продолжает работать | нет функции (I-02) |
| **Speed up / down / reset** | `AppSettings.speedModifier` −100…100 (`EmulatorScreen.java:1370-1390`) | **нет** | нет | нет функции (I-08) |
| Capture to file / clipboard (Alt+S/C) | `EmulatorScreen.java:1322` | не нужна: кадр уже в браузере | нет | нет функции, делается на клиенте (I-10) |
| Zoom, resize mode, interpolation, rotate | `Settings.resizeMode`, `AppSettings`, `EmulatorScreen.updateCanvasRect:507` | не нужна | Screen-вид, целочисленный и сглаженный масштаб, поворот картинки | реализовано на клиенте |
| Fullscreen, Keypad window | SWT | не нужна | кнопка полноэкранного режима, `Keypad` | реализовано |
| Record keys / Auto-play | `KeyRecords`, ключ `-rec` (`Emulator.parseLaunchArgs`) | аргумент командной строки | нет | нет функции (I-11) |
| QWERTY mode | `MENU_TOOL_QWERTY_MODE` | — | свои привязки клавиатуры и E71 | частично |
| X-Ray, Force paint | `EmulatorScreen.java:1713`, `AppSettings.xrayView` | `X` (без эффекта в Bridge) | нет | ограничение ядра (I-09) |
| Show track info / method tracking | `Settings.enableMethodTrack`, `threadMethodTrack` (`CustomMethodAdapter.java:251,418`) | — (ключи `property.txt`) | нет; вывод идёт только в SWT-таблицу `Methods.java` | ограничение ядра (I-09) |
| Info, Memory view, Watches, Profiler, Methods, M3G view, Media view | SWT-окна (`InfosBox`, `MemoryView`, `Watcher`, `Methods`, `M3GViewUI`, `MediaView`) поверх `debug/Memory.java`, `Profiler.java`, `MediaUtils.java` | **нет** | нет | ограничение ядра (I-09) |
| Log window | `Log.java` | stdout/stderr → `L` | панель «Emulator log» | реализовано |
| Sensor simulator | `emulator/sensor/SensorSimulator` (клиент внешнего OpenIntents SensorSimulator по TCP) | **нет** | нет | **[R]** датчики ускорения найдены (`found=2`), но данных нет (I-12) |
| SMS console | `MessageConsole`, `IEmulatorFrontend.getMessage()` | **нет**; `BridgeFrontend.getMessage()` возвращает `null` (`BridgeFrontend.java:145`) | нет | **дефект**: NPE в игре (I-03) |
| Disable network access | `Settings.networkNotAvailable` | — | вместо этого изоляция сети (netns): игра получает `UnknownHostException` | иная семантика (I-14) |
| Check update / Help / About | — | — | — | не применимо |

## 4. Настройки ядра и что из них записывает JGO

Два источника настроек (оба читаются в Bridge-режиме **[S]**):

* `AppSettings.load` — на игру, секция `midlets.ini` в каталоге пользователя (`-Dkem.userpath`, у JGO `data/saves/<owner>/<игра>`). JGO пишет **9 ключей**: `ScreenWidth`, `ScreenHeight`, `KeyLeftSoft`, `KeyRightSoft`, `KeyFire`, `KeyUp`, `KeyDown`, `KeyLeft`, `KeyRight`, а при выбранном пресете ещё `DevicePreset`, `IgnoreFullScreenMode`, `MIDPPlatform` (`apps/api/src/appSettings.ts`).
* `Property.loadProperties` — глобальные, файл `property.txt` в том же каталоге (`ui/swt/Property.java:327-330`). JGO его **не создаёт**, значения — по умолчанию. **[R]** файл `property.txt` читается Bridge-режимом: `SoundfontPath=…` в нём приводит к открытию SF2 (раздел 5).

Ключи, которые существуют в ядре и **никак не доступны** из JGO (перечень — из `AppSettings.java` и `Property.java`, фиктивных ключей в JGO нет):

| Группа | Ключи |
|---|---|
| Выполнение (`midlets.ini`) | `FrameRate`, `IgnoreSleep`, `IgnoreGc`, `ApplySpeedToSleep`, `PatchYield`, `FPSLimitJLStyle`, `AsyncFlush`, `StartAppOnResume`, `SynchronizeKeyEvents` |
| Ввод | `EnableKeyRepeat`, `KeyPressOnRepeat`, `HasPointerEvents`, `MotorolaSoftKeyFix`, `Motorola`, `Siemens`, `Sharp` |
| Среда игры | `MIDPLocale`, `FileEncoding`, `SystemProperties`, `FontSmallSize`/`FontMediumSize`/`FontLargeSize` |
| 3D | `M3GAA`, `M3GTexFilter`, `M3GMipmapping`, `M3GThread`, `M3GFlushImmediately`, `M3GForcePerspectiveCorrection`, `M3GIgnoreOverwrite`, `M3GDisableLightClamp`, `Mascot*` |
| Глобальные (`property.txt`) | `SoundfontPath`, `MIDIGlobalSequencer`, `MIDIReopenDevice`, `UseMaSmwForMIDI`, `WavCache`, `EnableVlc`, `VlcDir`, `EnableMediaDump`, `OTTConverter`, `3D_Graphics_Engine`, `Micro3D_Engine`, `M3GContextMode`, `DefaultFont`/`MonospacedFont`, `SecurityEnabled`, `ProtectedPackages`, `NetworkNotAvailable`, `ProxyType`… |
| Аргументы запуска | `-xray`, `-rec`, `-fontname/-fontsmall/-fontmedium/-fontlarge`, `-key`, `-cp`, `-lwj/-swerve`, `-mascotgl/-mascotsw` (`Emulator.parseLaunchArgs:754`); JGO передаёт `-bridge -s -screen -jar [-jad] [-midlet]` (`adapter.ts` `buildJavaArgs`) |

Практическое значение: JGO получает **значения по умолчанию ядра**, а не «настройки игры». Это не дефект, но все «профили», которые советуют по forum/KEmulator-гайдам для конкретных игр, в JGO недостижимы (I-07).

## 5. Отдельные исследования

### 5.1 TextBox, TextField и ввод текста

| Вопрос | Результат |
|---|---|
| Рисуется ли `TextBox`? | Да, **только для чтения**: патч `0006` (`TextBoxHeadless`) рисует текст в кадр, `getString/setString/insert/delete` работают как модель. **[T]** `bridge-regressions.test.ts:57`; **[R]** `packets`: пакеты `D`=`B`, `T`=`Name`, 1 кадр |
| Рисуется ли `List`? | Да, `ListHeadless`; стрелки и Fire работают. **[T]** `bridge-regressions.test.ts:41` |
| Можно ли набрать текст в `TextField` формы? | **Нет.** **[R]** `textfield`: в `Form` с `TextField("Name","player")` отправлены клавиши `5 6 7 1 Fire`, касание и `E zzz` — значение осталось `player`, `caret=0`, `itemStateChanged` не вызывался, пакетов `A` ноль, в логе `RuntimeException: Not implemented` |
| Почему | три причины в ядре, **[S]**: (1) `BridgeInput` не реализует `E` (`:110`); (2) нет отправителя `A`, `getCaret()` = `DummyCaret` с пустыми методами; (3) `TextBoxHeadless` и `Form`/`TextField` не принимают символы клавиш. Для JGO (Node/React) данных для окна ввода просто нет |
| Что нужно | патч ядра (приём `E`, отправка `A` с областью и текстом, вызов `TextField.setString` + `itemStateChanged`) и клиентская часть (поле ввода поверх области `A`, для `TextBox` — экранное поле). Задача I-01 (P0): без этого не проходятся игры, требующие ввода имени |

### 5.2 Звук: WAV, MP3, AMR, MIDI, тон

**[R]** `media` — пробный MIDlet (`tools/audit/src/MediaProbe.java`) проигрывает по 1,5 с через `Manager.createPlayer` и измеряет PCM, пришедший по FIFO звука:

| Источник | `createPlayer` | PCM (длительность / RMS) | Вывод |
|---|---|---|---|
| `Manager.playTone(69, 900, 100)` | OK | 1,32 с / 2129 | работает (Gervill) |
| WAV 22,05 кГц 440 Гц | OK, `getDuration`=1,5 с | 1,79 с / 2803 | работает |
| MP3 (libmp3lame, 880 Гц) | OK, `getDuration`=`TIME_UNKNOWN` | 1,97 с / 4975 | **работает** (javazoom) — ранее значилось «не проверено» |
| AMR-NB (синтетический поток, 12,2 кбит/с) | OK, `getDuration`=1,5 с | 1,82 с / 7479 (шум) | путь декодера работает; качество на настоящих AMR **не подтверждено** |
| SMF MIDI (нота C4) | OK, `getDuration`=0,5 с | 1,63 с / 1067 | работает |

Список типов, который ядро объявляет игре (**[R]**): `audio/midi audio/x-midi audio/wav audio/x-wav audio/x-tone-seq audio/amr audio/x-amr audio/mpeg audio/mp3`; протоколы: `device://tone capture://video capture://image file http https`. **Видео (`video/*`) нет**: VLC (`Settings.enableVlc = true`, `Settings.java:112`) в образе JGO не установлен — ограничение окружения, не проверялось.

### 5.3 MIDI SoundFont

`EmulatorMIDI.useCustomSoundfont` (`src/media/emulator/media/EmulatorMIDI.java:26`) берёт путь из `Settings.soundfontPath`, который читается из ключа `SoundfontPath` файла `property.txt` (`Property.java:499`). **[R]** `soundfont`: тот же MIDI-MIDlet, SF2-файл под уникальным именем, `strace -f -e openat`:

| Сценарий | Воспроизведение | Открытий SF2 |
|---|---|---|
| без `property.txt` | OK | 0 |
| `SoundfontPath=<файл>` в `property.txt` каталога игры | OK | **2** |

Вывод: настройка **работает без патчей**, достаточно записать файл. В JGO такой настройки нет, поэтому MIDI-музыка играет встроенным «аварийным» банком Gervill. Это функция, которой нет в JGO (I-04); слуховое качество я не оценивал.

### 5.4 Пауза и скорость

В `BridgeInput.handleEvent` нет ни одной команды, затрагивающей `AppSettings.steps`, `AppSettings.speedModifier` или `EventQueue.EVENT_PAUSE/RESUME` **[S]**; **[R]** `S 2` и `Z 1` отвергаются как неизвестные типы. Единственные доступные клиенту «внешние» способы — убить процесс или заморозить его сигналом, что не равно паузе игры (таймеры/звук/сеть). Нужна новая команда в патче ядра (I-02, I-08).

### 5.5 Отладочные функции

Ядро содержит модель данных (`debug/Memory.java`, `Profiler.java`, `MediaUtils.java`, трассировка методов в `CustomMethodAdapter.java`), но потребители — SWT-окна. Через Bridge не доступно ничего, кроме лога (stdout/stderr → панель «Emulator log»). Для JGO это нормально для пользователя; для разработчика совместимости полезен экспорт диагностики (I-09). Фиктивных переключателей в JGO нет.

### 5.6 Необязательные JSR (**[R]** `apis`, пробный MIDlet `ApiProbe`)

| API | Результат | Замечание |
|---|---|---|
| WMA / SMS (`sms://`) | **FAIL**: `NullPointerException … IEmulatorFrontend.getMessage() is null` | дефект: исключение не «безопасное», а NPE из ядра (I-03) |
| JSR-75 FileConnection | OK: запись `file:///root1/audit.txt`, корни `root/` | файлы лежат в каталоге пользователя игры (попадают в `jgo backup`), смотреть и выгружать их негде (I-13) |
| PIM | OK (`PIMImpl`) | содержимое не проверялось |
| Location (JSR-179) | OK (`EmulatedLocationProvider`) | координаты — заглушка эмулятора; данные из браузера не передаются |
| Sensor (JSR-256) | OK, найдено 2 датчика ускорения | данных нет: источник — внешний SensorSimulator по TCP (I-12) |
| Bluetooth | `LocalDevice` возвращается как `null` | заглушка |
| Camera (`capture://video`) | FAIL `WebcamException` | на сервере нет камеры; ограничение окружения |
| `microedition.platform` | `Nokia6700c-1/13.10` (по умолчанию) | меняется пресетом устройства |

## 6. Противоречия и устаревшие утверждения

| Где | Что было | Что на самом деле | Статус |
|---|---|---|---|
| `apps/api/src/sessions.ts` (`case 'D'`) | лог «textbox/list screens are not rendered by the Bridge frontend yet» | с патчем `0006` приходит только `B`; предупреждение недостижимо | **исправлено** (удалено, добавлен комментарий) |
| `apps/web/src/components/Player.tsx` (`displayable`) + `i18n/ru.json` | тост «игра открыла экран …, который Bridge пока не поддерживает» | то же | **исправлено** (удалено вместе с переводом) |
| `docs/BRIDGE.md` п. 8 | «TextBox/List: setCurrent бросает … клиент показывает предупреждение» | противоречит п. 9 (исправлено патчем `0006`) | **исправлено**: п. 8 описывает стоковое поведение и ссылается на п. 9 |
| `docs/BRIDGE.md` (вводная часть) | «остановка — закрытие `inputpipe`, через 3 с SIGKILL» | остановка идёт командой `Q` с 8 с ожидания (патч `0009`) | **исправлено** |
| `docs/BRIDGE.md` (итог по пакетам) | «`O`, `I`, `A` реализованы в сессии» | `I` и `A` сессия отбрасывает, `A` ядро не отправляет | **исправлено** |
| `docs/BRIDGE.md` (раздел «Звук») | «не проверено: MP3, AMR» | MP3/AMR/MIDI/тон проверены (5.2) | **исправлено** |
| `README.md`, `README.en.md` | «экраны TextBox и List Bridge не реализует» | рисуются, не работает ввод текста | **исправлено** (README переписан) |
| спецификация `BridgeFrontendDocs.md` | `U` и `A` описаны как существующие | `U` в стоке никем не отправляется (добавлен патчем `0008`), `A` не отправляется вовсе | зафиксировано здесь и в таблицах |
| `BridgeFrontendDocs.md` | «код выхода 29 = ошибка чтения `inputpipe`» и т. п. | в JGO дополнительно используются 27/28 из-за гонки при остановке (`docs/BRIDGE.md` п. 16) | согласовано, дублирования нет |
| `docs/COMPATIBILITY.md` | «выбор пресета в UI не добавлен» | выбор есть (ранее исправлено) | уже исправлено |

Расхождений между патчами не найдено: `0001–0009` независимо применяются к `9ec1005` (`runtime/scripts/build-kemulator.sh` останавливает сборку при провале), `0006` и `0009` оба меняют `BridgeInput/BridgeOutput`, но в разных участках.

## 7. Классификация

**Реальные дефекты** (подтверждены запуском)
* D-1. SMS (`javax.wireless.messaging`) → `NullPointerException` из `BridgeFrontend.getMessage()==null`; игра теряет поток (I-03).
* D-2. Устаревшие предупреждения и противоречия в коде и документации (раздел 6) — исправлены в этом аудите.

**Отсутствующие функции** (ядро умеет, JGO не показывает)
* F-1. Ввод текста (**ограничение ядра** + клиент) — I-01.
* F-2. Пауза, шаг, suspend/resume MIDlet, автопауза скрытой вкладки — I-02.
* F-3. Выбор MIDI SoundFont (работает записью `property.txt`) — I-04.
* F-4. Открытие ссылки из `platformRequest` (`U`) — I-06.
* F-5. Параметры выполнения/ввода/3D на игру из `AppSettings` — I-07.
* F-6. Скорость игры — I-08; диагностика — I-09; снимок экрана — I-10; запись/воспроизведение клавиш — I-11.
* F-7. Датчики и геолокация из браузера — I-12; файловая область JSR-75 — I-13.

**Неподтверждённая совместимость**
* Mascot Capsule v3 с `.mbac`, M3G retained mode/текстуры/освещение; видео (`video/*`, VLC); настоящие AMR/MP3 из игр; полифония MIDI и качество встроенного банка; содержимое PIM и значения Location; сеть «как в телефоне» (`NetworkNotAvailable`); производительность 3D на реальных играх — I-14.

**Ограничения самого ядра в Bridge-режиме**
* `E` не реализован, `A` не отправляется, `X` не меняет картинку, нет команд паузы/скорости, `getMessage()==null`, `loadFont()` возвращает `null` (`BridgeFrontend.java:195`), `getGraphics3D()` бросает ошибку (`:215`), `TargetedCommand` без привязки к элементу, размер кадра фиксируется при старте, класс-файлы версии ≥ 49 не загружаются, отладочные окна существуют только в SWT, протокол не версионируется (автор предупреждает о ломающих изменениях — I-05).

## 8. Дорожная карта (GitHub Issues)

Приоритеты: **P0** — блокирует прохождение игр или основной сценарий; **P1** — заметная функция или надёжность; **P2** — удобство, диагностика, исследование. Критерии приёмки — в тексте каждой задачи.

| ID | Приоритет | Задача | Issue | Статус |
|---|---|---|---|---|
| I-01 | P0 | Ввод текста: `TextField`/`TextBox` (Bridge `E`/`A`, редактор в UI) | [#6](https://github.com/grayhex/JGO/issues/6) | сделано (патч `0010`), см. §9 |
| I-02 | P1 | Пауза, suspend/resume MIDlet и автопауза скрытой вкладки | [#7](https://github.com/grayhex/JGO/issues/7) | сделано (патч `0012`) |
| I-03 | P1 | SMS/WMA: управляемая ошибка вместо NPE | [#8](https://github.com/grayhex/JGO/issues/8) | сделано (патч `0011`) |
| I-04 | P1 | Настройка MIDI SoundFont (`SoundfontPath`) | [#9](https://github.com/grayhex/JGO/issues/9) | сделано |
| I-05 | P1 | Контрактные тесты Bridge: проба → автоматические проверки в CI | [#10](https://github.com/grayhex/JGO/issues/10) | сделано |
| I-06 | P2 | Ссылки из `platformRequest`: явное подтверждение и открытие | [#11](https://github.com/grayhex/JGO/issues/11) | сделано |
| I-07 | P2 | Параметры эмуляции на игру (реальные ключи `AppSettings`) | [#12](https://github.com/grayhex/JGO/issues/12) | сделано |
| I-08 | P2 | Скорость игры (speed modifier) | [#13](https://github.com/grayhex/JGO/issues/13) | сделано (патч `0013`) |
| I-09 | P2 | Диагностика: X-Ray, force paint, трассировка, снимок памяти | [#14](https://github.com/grayhex/JGO/issues/14) | сделано частично: экспорт диагностики; X-Ray и окна SWT — ограничение ядра |
| I-10 | P2 | Снимок экрана и запись GIF на клиенте | [#15](https://github.com/grayhex/JGO/issues/15) | сделано (PNG; запись GIF не делалась) |
| I-11 | P2 | Запись и воспроизведение клавиш (`-rec`) | [#16](https://github.com/grayhex/JGO/issues/16) | сделано (на клиенте) |
| I-12 | P2 | Датчики и геолокация из браузера (исследование) | [#17](https://github.com/grayhex/JGO/issues/17) | исследовано, решение «не делаем сейчас»: [SENSORS.md](SENSORS.md) |
| I-13 | P2 | Файловая область игры (JSR-75): просмотр, выгрузка, загрузка | [#18](https://github.com/grayhex/JGO/issues/18) | сделано |
| I-14 | P2 | Бэклог проверки совместимости (неподтверждённое) | [#19](https://github.com/grayhex/JGO/issues/19) | частично проверено, остальное — §9.2 |

Задачи заведены на GitHub: I-01…I-14 = [#6…#19](https://github.com/grayhex/JGO/issues). Критерии приёмки — в тексте каждой.

## 9. Что изменилось после аудита (задачи #6–#19)

Все задачи сделаны в одной ветке; ядро получило патчи `0010…0013`. Каждая функция проверена на настоящем эмуляторе (файл теста — в последнем столбце).

### 9.1 Результат по задачам

| Issue | Что теперь | Как проверено |
|---|---|---|
| [#6](https://github.com/grayhex/JGO/issues/6) ввод текста | фокус на `TextField`/`TextBox` → пакеты `N` + `A`; текст от клиента → `E <percent-encoded UTF-8>`; усечение до `maxSize`, фильтр `NUMERIC`/`DECIMAL`/`PHONENUMBER`, `UNEDITABLE` не правится, `itemStateChanged` вызывается; в плеере — редактор (пароль скрыт, подходящая клавиатура, `maxlength`, многострочный для `TextBox`) | `tests/integration/text-input.test.ts`, `tests/e2e/text-input.mjs` |
| [#7](https://github.com/grayhex/JGO/issues/7) пауза | команда `S 1`/`S 0`: `hideNotify`+`pauseApp`, цикл отрисовки заморожен, кадры не идут; при продолжении `startApp`+`showNotify`; кнопка Pause/Resume; игра приостанавливается, когда ни один зритель не видит страницу | `tests/integration/pause.test.ts`, `tests/e2e/pause.mjs` |
| [#8](https://github.com/grayhex/JGO/issues/8) SMS | `getMessage()` возвращает заглушку: `send` бросает `IOException("SMS is not available")`, вместо `NullPointerException` | `bridge-regressions.test.ts` (SMS) |
| [#9](https://github.com/grayhex/JGO/issues/9) SoundFont | загрузка SF2 в Settings; путь пишется в `property.txt` при каждом старте; эмулятор открывает файл (доказано `strace`) | `tests/integration/soundfont.test.ts`, `apps/api/src/soundfont.test.ts`, `tests/e2e/soundfont.mjs` |
| [#10](https://github.com/grayhex/JGO/issues/10) контрактные тесты | декодируются все исходящие пакеты (`D T C M V P U I N A`); устойчивость к плохому вводу (`X I E S K T C P`, неизвестные типы) | `tests/integration/bridge-contract.test.ts` |
| [#11](https://github.com/grayhex/JGO/issues/11) ссылки | диалог с полным адресом, «Открыть» только по клику, `noopener noreferrer`; `javascript:`/`file:`/`data:` по-прежнему отсекаются сервером | `tests/e2e/player-tools.mjs`, `bridge-regressions.test.ts` |
| [#12](https://github.com/grayhex/JGO/issues/12) параметры | `GameSettings.emulation`: `FrameRate`, `StartAppOnResume`, `MIDPLocale`, `HasPointerEvents`, `Font*Size` — каждый ключ доказан наблюдением из игры; неизвестные и неверные значения отвергаются | `tests/integration/speed-and-tweaks.test.ts`, `tests/e2e/emulation-options.mjs` |
| [#13](https://github.com/grayhex/JGO/issues/13) скорость | команда `Y n` (−100…100, не 0), кнопки ×0.25…×4; исправлена формула сна ядра при замедлении (стоковая растягивала `sleep` в 5·\|m\| раз) | `speed-and-tweaks.test.ts` (часы игры идут в 0,5×/1×/2×) |
| [#14](https://github.com/grayhex/JGO/issues/14) диагностика | `GET /api/sessions/:id/diagnostics`: настройки, журнал, `jcmd` (версия, куча, потоки JVM); кнопка в панели Session. Данные JVM требуют `jcmd` (пакет `openjdk-21-jdk-headless`); при установке только JRE (`install/jgo-install.sh`, образ Docker) отчёт содержит всё остальное и честно пишет, чего нет | `tests/integration/diagnostics.test.ts` |
| [#15](https://github.com/grayhex/JGO/issues/15) снимок | PNG в размере кадра игры (с поворотом), сохранить или скопировать | `tests/e2e/player-tools.mjs` |
| [#16](https://github.com/grayhex/JGO/issues/16) запись | запись/воспроизведение клавиш, касаний, команд и текста с таймингом, файл привязан к игре | `apps/web/src/recording.test.ts`, `tests/e2e/player-tools.mjs` |
| [#17](https://github.com/grayhex/JGO/issues/17) датчики | исследование, решение «не делаем сейчас»: [SENSORS.md](SENSORS.md) | запуск в изолированном сетевом пространстве |
| [#18](https://github.com/grayhex/JGO/issues/18) файлы игры | панель «Файлы игры»: список, скачать, загрузить, удалить; проверка пути по сегментам (без `..`, абсолютных путей, обратных слэшей, NUL, символических ссылок), квота 64 МБ | `tests/integration/game-files.test.ts`, `tests/e2e/player-tools.mjs` |
| [#19](https://github.com/grayhex/JGO/issues/19) совместимость | см. 9.2 | — |

Что не вошло и почему: **запись GIF** (в #15 она помечена «опционально»), **X-Ray, Force paint, окна `Info/Memory/Watches/Profiler/Methods/M3G view`** (#14: ядро рисует X-Ray только в SWT-окне, `BridgeOutput.sendBuffer` всегда копирует обычный буфер — это ограничение ядра, переключатель без эффекта не добавлялся).

### 9.2 Бэклог совместимости (#19)

| Пункт | Статус | Основание |
|---|---|---|
| M3G retained mode, освещение, текстуры | **подтверждено** | `tests/integration/m3g-retained.test.ts`: `World` + `Camera` + `Light` + `Material` + `Texture2D` рисуются под Xvfb/llvmpipe, шахматная текстура видна |
| MP3 | **подтверждено** | реальный MP3 (ffmpeg/libmp3lame) играет, PCM ненулевой (`tools/audit/results.json`) |
| AMR | **частично**: тракт декодера работает на синтетическом потоке; реального AMR нет — в среде нет энкодера (`ffmpeg -encoders`: без AMR) | нужен AMR из настоящей игры |
| MIDI | **подтверждено**: проигрывается встроенным банком и пользовательским SF2 (см. #9); качество на слух и полифония — не оценивались | `soundfont.test.ts` |
| Location (JSR-179) | **ограничение ядра**: возвращается зашитый список координат | [SENSORS.md](SENSORS.md) |
| Sensor (JSR-256) | **ограничение конфигурации**: источник — внешний сервер, недоступный из сети игры | [SENSORS.md](SENSORS.md) |
| PIM, Bluetooth, камера | **ограничение ядра**: заглушки / `null` / сбой (аудит §5.6) | аудит `apis` |
| Видео (`video/*`) | **не поддерживается этой конфигурацией**: нужен VLC на сервере, типы `video/*` отсутствуют в `getSupportedContentTypes` | аудит `media` |
| Mascot Capsule v3 с `.mbac` | **не проверено**: нет свободно распространяемой модели; примитивы рисуются (тест при `KEM_DISPLAY`) | нужна игра пользователя |
| «Сеть как в телефоне» | **иная семантика**: игра получает `UnknownHostException` из-за сетевой изоляции; `NetworkNotAvailable` ядра не используется | `jgo network allow` отключает изоляцию |
| Производительность 3D на реальных играх | **не оценивалась**; на тестовой сцене — см. `3d.test.ts` | нужны игры пользователя |

## 10. Чего аудит не делал

* Не оценивал качество звука на слух и производительность на реальных играх.
* AMR проверен синтетическим потоком; видео и камера не проверялись (нет VLC и камеры).
* Аудит выполнен для KEmulator `9ec1005` с патчами JGO; другая версия ядра потребует повторного запуска `tools/audit/probe.mjs`.
