# Polityka prywatności – Mobile Emulator

_Ostatnia aktualizacja: 29 września 2026_

Mobile Emulator to rozszerzenie przeglądarki Chrome. Sprawia, że strony w wybranej karcie wyświetlają się tak, jak na telefonie.

## Jakie dane zbieramy

**Żadnych.** Rozszerzenie nie zbiera danych osobowych, historii przeglądania, treści stron ani informacji o aktywności. Nie ma kont, analityki ani telemetrii.

## Jak dane są przechowywane

Rozszerzenie zapisuje wyłącznie własne ustawienia, i to tylko lokalnie w Twojej przeglądarce:

- `chrome.storage.local` – wybrane urządzenie, tryb, widok i orientacja;
- `chrome.storage.session` – które karty mają włączoną emulację. Te dane znikają po zamknięciu przeglądarki.

Ustawienia nie są synchronizowane między urządzeniami i nie opuszczają Twojego komputera.

## Jak dane są używane

Adres bieżącej karty jest sprawdzany tylko w pamięci. Służy do tego, żeby nie włączać emulacji na stronach wewnętrznych Chrome i w Chrome Web Store. Nie jest nigdzie zapisywany ani wysyłany.

W trybie lekkim rozszerzenie dopisuje do stron w emulowanej karcie techniczny nagłówek `Server-Timing` (`mobemu`). Na stronach `http://` dopisuje też cookie `__mobemu` ważne 5 sekund, które skrypt rozszerzenia usuwa od razu po odczytaniu. Oba zawierają wyłącznie profil emulowanego telefonu (User-Agent, wymiary ekranu) i żadnych danych o Tobie.

## Usługi zewnętrzne

Brak. Rozszerzenie nie wysyła żadnych własnych zapytań sieciowych i nie korzysta z usług firm trzecich.

## Udostępnianie danych

Nie udostępniamy ani nie sprzedajemy żadnych danych, bo żadnych nie zbieramy.

## Przechowywanie i usuwanie danych

Ustawienia usuniesz, odinstalowując rozszerzenie albo czyszcząc jego dane w `chrome://extensions`. Stan kart znika po zamknięciu przeglądarki.

## Uprawnienia

- `debugger` – tryb pełny: emulacja telefonu (ekran, dotyk, User-Agent) w karcie, w której ją włączysz.
- `declarativeNetRequest` – tryb lekki: nagłówki telefonu w emulowanej karcie.
- `scripting`, `webNavigation`, dostęp do stron – podmiana informacji o urządzeniu przed skryptami strony, tylko w emulowanej karcie.
- `tabs` – rozpoznanie karty i jej adresu.
- `storage` – zapis ustawień.

## Zmiany polityki

Zmiany opisujemy w tym pliku i w [historii repozytorium](https://github.com/matmaxalez/mobilebrowser/commits/main/PRIVACY.md).

## Kontakt

Pytania i zgłoszenia: https://github.com/matmaxalez/mobilebrowser/issues
