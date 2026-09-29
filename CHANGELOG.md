# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

## [1.1.0] – 2026-09-29

### Dodane
- Aktywacja wtyczki kodem (`MOB-XXXX-XXXX-XXXX-XXXX`). Działa offline, a do wtyczki trafiają tylko solone skróty SHA-256 kodów. Formularz w popupie, dezaktywacja wyłącza emulację we wszystkich kartach.
- `scripts/generate-codes.mjs` generuje nowy zestaw kodów albo dopisuje kody do obecnego.

## [1.0.1] – 2026-09-29

### Zmienione
- Opis w manifeście pisany z perspektywy użytkownika (zgodnie z wytycznymi Chrome Web Store), `homepage_url`.
- `CHROMEWEBSTORE.md`, grafiki do sklepu w `store-assets/`, rozszerzona polityka prywatności.
- Narzędzia AI zalecane przez Google: skill `chrome-extensions` w repo, Chrome DevTools MCP (`.mcp.json`).
- Instrukcja w README dla błędu „Brak pliku manifestu” przy „Załaduj rozpakowane”.

## [1.0.0] – 2026-09-29

### Dodane
- Emulacja urządzenia mobilnego w pojedynczej karcie: przełącznik w popupie i skrót <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>.
- Tryb **pełny** (`chrome.debugger` / CDP). Emuluje User-Agent, Client Hints, `navigator.userAgentData`, dotyk, zdarzenia dotyku z myszy, `pointer: coarse` / `hover: none` w CSS oraz ekran i orientację.
- Widoki trybu pełnego: **cała karta bez ramki telefonu** (domyślny), szerokość telefonu rozciągnięta na kartę, dokładny rozmiar 1:1.
- Tryb **lekki** bez paska debugowania. Działa na nagłówkach DNR i podmianie `navigator`/`screen`/`matchMedia` przed skryptami strony. Opcjonalnie otwiera okno o rozmiarze telefonu.
- 11 profili urządzeń (Pixel, Galaxy, iPhone, iPad, Galaxy Tab) oraz urządzenie własne z własnym UA.
- Dziedziczenie emulacji przez karty otwarte z emulowanej karty.
- Testy E2E (Playwright + prawdziwy Chromium), CI i automatyczne wydania ZIP.

### Poprawione (audyt przed wydaniem)
- Tryb lekki: dwie karty włączane jednocześnie mogły dostać te same reguły DNR. Jedna z nich pokazywała LITE, ale wysyłała UA desktopu, a wyłączenie jednej psuło drugą.
- Tryb lekki: karty otwarte z emulowanej karty nie dziedziczyły emulacji.
- Tryb pełny: dziedziczenie przeładowywało puste okna wypełniane przez stronę (`window.open('')` + `document.write`) i ponownie wysyłało formularze POST.
- Tryb lekki: znacznik profilu przenosi teraz `Server-Timing` przypisany do jednej odpowiedzi zamiast cookie wspólnego dla hosta. Znacznik nie wycieka już do innych kart, także po przekierowaniach.
- Zamknięcie karty w trakcie włączania nie zostawia już martwego stanu ani reguł. Nieudane włączenie trybu lekkiego nie pokazuje już ON.
- Zmiana niezwiązanej opcji (np. dziedziczenia) nie przeładowuje już emulowanej karty.
- Popup odświeża rzeczywisty stan po błędzie i blokuje kontrolki na czas operacji.
- `matchMedia('(pointer: fine)')` zwracało `true` w ramkach o zerowej szerokości.
