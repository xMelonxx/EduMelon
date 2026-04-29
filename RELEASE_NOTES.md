# Release Notes Template (EduMelon)

> Skopiuj ten szablon do opisu GitHub Release.  
> To pole jest wczytywane przez updater jako changelog (`update.body`).

## 🚀 EduMelon vX.Y.Z

Data: YYYY-MM-DD

## ✨ Nowe
- [ ] 
- [ ] 
- [ ] 

## 🛠 Poprawki
- [ ] 
- [ ] 
- [ ] 

## 🔒 Bezpieczeństwo / stabilność
- [ ] 
- [ ] 

## ⚠ Znane problemy
- [ ] 

## ⬆️ Jak zaktualizować
- Wejdź w `Ustawienia -> Aktualizacje aplikacji`.
- Kliknij `Sprawdź aktualizacje`.
- Kliknij `Pobierz`.
- Po pobraniu kliknij `Uruchom ponownie i zaktualizuj`.

---

## Przykład (wypełniony)

## 🚀 EduMelon v0.1.1-beta.1

Data: 2026-04-29

## ✨ Nowe
- Dodano formularz feedbacku z możliwością dodania do 3 zrzutów ekranu.
- Dodano sekcję changelogu przy dostępnej aktualizacji.
- Dodano ukryte odblokowanie dev tools (7 kliknięć w wersję aplikacji).

## 🛠 Poprawki
- Naprawiono politykę RLS dla zapisu `feedback_attachments`.
- Poprawiono onboarding: rekomendacja modelu uwzględnia RAM i GPU.
- Usprawniono diagnostykę Ollamy (`Napraw i sprawdź ponownie`).

## 🔒 Bezpieczeństwo / stabilność
- Załączniki feedbacku trafiają do prywatnego bucketu Storage.
- Ograniczono upload do typów PNG/JPG/WEBP i limitu 5 MB.

## ⚠ Znane problemy
- Przy pierwszym sprawdzeniu aktualizacji mogą pojawić się opóźnienia sieciowe.
