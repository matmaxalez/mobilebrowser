# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

## [1.0.0] – 2026-09-29

### Dodane
- Emulacja urządzenia mobilnego w pojedynczej karcie: przełącznik w popupie i skrót <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>.
- Tryb **pełny** (`chrome.debugger` / CDP). Emuluje User-Agent, Client Hints, `navigator.userAgentData`, dotyk, zdarzenia dotyku z myszy, `pointer: coarse` / `hover: none` w CSS oraz ekran i orientację.
- Widoki trybu pełnego: **cała karta bez ramki telefonu** (domyślny), szerokość telefonu rozciągnięta na kartę, dokładny rozmiar 1:1.
- Tryb **lekki** bez paska debugowania. Działa na nagłówkach DNR i podmianie `navigator`/`screen`/`matchMedia` przed skryptami strony. Opcjonalnie otwiera okno o rozmiarze telefonu.
- 11 profili urządzeń (Pixel, Galaxy, iPhone, iPad, Galaxy Tab) oraz urządzenie własne z własnym UA.
- Dziedziczenie emulacji przez karty otwarte z emulowanej karty.
- Testy E2E (Playwright + prawdziwy Chromium), CI i automatyczne wydania ZIP.
