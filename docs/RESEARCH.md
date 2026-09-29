# Research: emulacja urządzeń mobilnych we wtyczce Chrome

Notatki z researchu przed implementacją (wrzesień 2026, Chrome 154 stable). Opisują, jakie mechanizmy daje Chrome, jak robią to istniejące wtyczki i dlaczego ta wtyczka działa tak, a nie inaczej.

## 1. Po czym strona rozpoznaje telefon?

| Sygnał | Gdzie | Kto na tym polega |
|---|---|---|
| Nagłówek `User-Agent` | HTTP | serwery (przekierowania na `m.`, osobne szablony) |
| `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform`, `-Model`, `-Platform-Version` | HTTP (Client Hints) | coraz więcej serwerów i CDN-ów |
| `navigator.userAgent`, `platform`, `vendor`, `userAgentData` | JS | skrypty, biblioteki detekcji |
| `'ontouchstart' in window`, `navigator.maxTouchPoints`, `TouchEvent` | JS | funkcje „tylko na dotyk” |
| `(pointer: coarse)`, `(hover: none)` | CSS i `matchMedia` | style i funkcje mobilne |
| `screen.width/height`, `devicePixelRatio`, `screen.orientation` | JS | detekcja „małego ekranu” |
| szerokość viewportu (`@media (max-width…)`) | CSS | strony responsywne |

Pełna emulacja musi objąć wszystkie te sygnały naraz. Niespójność, np. mobilny UA bez dotyku, bywa wykrywana i strona wraca wtedy do wersji desktopowej.

## 2. Mechanizmy dostępne dla wtyczek MV3

### `chrome.debugger` + Chrome DevTools Protocol

Tak samo działa tryb urządzenia w DevTools, więc jest to najdokładniejsza metoda.

- `Emulation.setDeviceMetricsOverride`. Wymagane parametry: `width`, `height`, `deviceScaleFactor`, `mobile`. Opcjonalne: `screenOrientation`, a także eksperymentalne `scale`, `screenWidth` i `screenHeight`. Wartości `0` oznaczają „bez nadpisywania”.
- `Emulation.setTouchEmulationEnabled` przyjmuje `{ enabled, maxTouchPoints }`. Włącza `pointer: coarse` także w CSS.
- `Emulation.setEmitTouchEventsForMouse` przyjmuje `{ enabled, configuration: 'mobile' }` i zamienia mysz na zdarzenia dotyku (komenda eksperymentalna).
- `Emulation.setUserAgentOverride` przyjmuje `{ userAgent, platform, userAgentMetadata }`, gdzie metadata jest eksperymentalna. Wymagane pola metadata to `platform`, `platformVersion`, `architecture`, `model` i `mobile`. Opcjonalne to `brands`, `fullVersionList`, `fullVersion`, `bitness`, `wow64` i `formFactors`. Bez metadata Chrome nie wysyła Client Hints, tak jak Safari.
- `Page.addScriptToEvaluateOnNewDocument` uruchamia skrypt przed skryptami strony w każdym dokumencie. Działa dopiero po `Page.enable`.
- Nadpisania są przypisane do sesji debuggera, więc przetrwają nawigacje i przeładowania karty.
- **Minusy:**
  - Chrome pokazuje pasek „*<wtyczka>* rozpoczęło debugowanie tej przeglądarki”. Wtyczka nie może go ukryć; pozwala na to tylko flaga `--silent-debugger-extension-api` przy uruchamianiu Chrome.
  - Kliknięcie „Anuluj” odłącza wszystkie sesje (`onDetach` z `reason: 'canceled_by_user'`).
  - Blokują to niektóre polityki firmowe.
- Od Chrome 118 aktywna sesja debuggera utrzymuje service worker MV3 przy życiu. Stan i tak trzeba trzymać w `chrome.storage.session`.

Źródła:
- https://chromedevtools.github.io/devtools-protocol/tot/Emulation/
- https://developer.chrome.com/docs/extensions/reference/api/debugger
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

### `declarativeNetRequest` (DNR)

- Reguły sesyjne (`updateSessionRules`) obsługują `condition.tabIds`, więc nagłówki zmieniają się tylko w wybranej karcie. Limit to 5000 reguł sesyjnych.
- `modifyHeaders` z `set` i `remove` działa dla `user-agent` i `sec-ch-ua*` (sprawdzone testami E2E). `append` działa tylko dla nagłówków z listy dozwolonych, do której należy `set-cookie` w odpowiedziach.
- DNR zmienia wyłącznie HTTP. `navigator.*` zostaje prawdziwe, więc trzeba go podmienić osobno w JS.

Źródło: https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest

### Wstrzykiwanie skryptu w świecie MAIN

- `chrome.scripting.executeScript({ world: 'MAIN', injectImmediately: true })` wywołane z `webNavigation.onCommitted` działa „jak najszybciej, ale **nie gwarantuje** wykonania przed stroną”. Testy potwierdziły, że przegrywa z inline `<script>` w `<head>`.
- Content script zadeklarowany z `world: 'MAIN'` i `run_at: 'document_start'` wykonuje się niezawodnie przed skryptami strony, ale nie da się go ograniczyć do jednej karty.
- **Rozwiązanie w tej wtyczce:** reguła DNR dla konkretnej karty dopisuje do odpowiedzi dokumentu krótkotrwałe cookie `__mobemu` z profilem urządzenia. Content script w MAIN przy `document_start` czyta je synchronicznie z `document.cookie`, od razu kasuje i uruchamia podmianę. W kartach bez emulacji cookie nie istnieje i skrypt nic nie robi.

Źródło: https://developer.chrome.com/docs/extensions/reference/api/scripting

## 3. Jak to robią istniejące wtyczki

- **„Mobile Simulator” i podobne** wyświetlają stronę w `<iframe>` w ramce telefonu, na nakładce w Shadow DOM. Nagłówki `X-Frame-Options` i CSP `frame-ancestors` usuwają przez DNR, a UA zmieniają opcjonalnie. Wynik to „zdjęcie telefonu z przewijaną stroną w środku”, ale bez prawdziwego dotyku, DPR i `matchMedia`. **Użytkownik wprost nie chciał tego podejścia.**
- **User-Agent Switcher** i podobne łączą nagłówki DNR z nadpisaniem `navigator` w JS. Nie emulują dotyku, pointera ani ekranu.
- Tylko `chrome.debugger` daje pełną emulację na poziomie silnika.

Źródła:
- https://github.com/talah221/Mobile-Simulator
- https://chromewebstore.google.com/detail/mobile-simulator/ffdicjopgnblhkdhlfocbpbloapnkbdl

## 4. Aktualne ciągi User-Agent

- **Chrome na Androida** używa zredukowanego UA. Model i wersja Androida są zamrożone jako `Android 10; K`, a wersja Chrome ma postać `X.0.0.0`:
  `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36`
  Prawdziwy model i wersja systemu trafiają tylko do Client Hints. Wtyczka wstawia tu numer wersji Chrome, na którym działa.
- **Safari na iOS 26** ma wersję systemu zamrożoną na `18_6`:
  `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1`
  Safari nie ma Client Hints ani `navigator.userAgentData`.
- **Tablety z Androidem** mają UA bez tokenu `Mobile` i `Sec-CH-UA-Mobile: ?0`.

Źródła:
- https://nielsleenheer.com/articles/2025/the-user-agent-string-of-safari-on-ios-26-and-macos-26/
- https://developer.chrome.com/release-notes/154

## 5. Decyzje projektowe

1. **Domyślnie tryb pełny (CDP) z widokiem „cała karta”.** Strona dostaje wszystkie sygnały mobilne, a karta dalej wygląda zwyczajnie, zgodnie z wymaganiem. W tym widoku `mobile: false` wyłącza mobilne auto-powiększanie tekstu, które powodowało wychodzenie strony poza kartę. `screenWidth/Height` dalej podają wymiary telefonu.
2. **Tryb lekki jako alternatywa bez paska debugowania:** DNR + skrypt MAIN sterowany cookie. Opcjonalnie przenosi kartę do okna o rozmiarze telefonu.
3. **Stan na kartę w `chrome.storage.session`** z odtwarzaniem po restarcie service workera. Operacje na karcie idą przez kolejkę, żeby szybkie kliknięcia się nie przeplatały.
4. **Dziedziczenie emulacji** przez karty otwarte z emulowanej karty (`openerTabId`).
5. **Testy E2E w prawdziwym Chromium** (Playwright z załadowaną wtyczką) przeciw lokalnemu serwerowi, który odsyła nagłówki. Weryfikują oba tryby, wszystkie widoki, dziedziczenie i odmowę na stronach `chrome://`.
