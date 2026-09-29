# Polityka prywatności

**Mobile Emulator nie zbiera, nie przechowuje poza Twoim komputerem ani nie wysyła żadnych danych.**

- Wtyczka nie ma serwera, analityki ani telemetrii.
- Ustawienia (wybrane urządzenie, tryb, widok) są zapisane lokalnie w `chrome.storage.local`. Stan emulacji kart jest w `chrome.storage.session` i znika po zamknięciu przeglądarki.
- Uprawnienia są potrzebne wyłącznie do emulacji w kartach, w których ją włączysz:
  - `debugger` – tryb pełny (Chrome DevTools Protocol: viewport, dotyk, User-Agent);
  - `declarativeNetRequest` – podmiana nagłówków `User-Agent` / Client Hints w trybie lekkim;
  - `scripting`, `webNavigation`, dostęp do stron (`<all_urls>`) – uruchomienie podmiany `navigator` przed skryptami strony;
  - `tabs` – rozpoznanie karty i jej adresu (np. żeby odmówić na stronach `chrome://`);
  - `storage` – zapis ustawień.
- W trybie lekkim wtyczka dopisuje do odpowiedzi stron w emulowanej karcie techniczny nagłówek `Server-Timing` (`mobemu`). Na stronach `http://` dopisuje też cookie `__mobemu` ważne 5 s, które skrypt wtyczki usuwa od razu po odczytaniu. Oba zawierają wyłącznie profil emulowanego urządzenia (UA, wymiary ekranu), żadnych danych o Tobie, i nie są wysyłane do żadnego serwera.
