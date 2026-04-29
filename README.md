# EduMelon

Lokalna aplikacja desktopowa (Tauri + React) do analizy prezentacji (PDF/PPTX), streszczeń, fiszek i czatu z modelem przez **Ollama**. Opcjonalnie można wysyłać do **Supabase** anonimowe statystyki użycia (instalacja + kierunek).

## Wymagania

- [Node.js](https://nodejs.org/) LTS
- [Rust](https://rustup.rs/) (toolchain `stable`)
- [Ollama](https://ollama.com/) uruchomiona lokalnie (`http://127.0.0.1:11434`)

## Szybki start (dev)

```bash
npm install
cp .env.example .env
# Uzupełnij .env jeśli używasz Supabase lub innych tagów modeli
npm run tauri dev
```

Przy pierwszym uruchomieniu aplikacja sprawdzi Ollama, przeprowadzi onboarding (imię, uczelnia, kierunek, **folder na modele**, wybór profilu **e2b-it** / **e4b-it**) i pobierze modele czatu oraz embeddingów.

## Tryb ciemny

W nagłówku aplikacji (ikona słońca / księżyca / auto) lub w **Ustawienia → Wygląd** możesz ustawić motyw: jasny, ciemny albo zgodny z systemem. Preferencja jest zapisywana w `localStorage` (`edumelon_theme`).

## Katalog modeli Ollama (`OLLAMA_MODELS`)

Domyślnie Ollama trzyma modele we własnym katalogu użytkownika. Aby **wskazać własny dysk/folder**, w onboardingu lub w ustawieniach wybierz folder — aplikacja zapisze ścieżkę i pokaże polecenie PowerShell ustawiające zmienną użytkownika:

```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', 'D:\Twoj\Folder', 'User')
```

Po ustawieniu zmiennej **zrestartuj Ollama** (zamknij z paska i uruchom ponownie), żeby `ollama pull` zapisywał pliki w wybranym miejscu. Szczegóły: [FAQ Ollama](https://docs.ollama.com/faq).

## Modele Ollama

- **Czat:** tagi z `VITE_OLLAMA_MODEL_E2B_IT` / `VITE_OLLAMA_MODEL_E4B_IT` (domyślnie `gemma4:e2b` / `gemma4:e4b`; dopasuj do `ollama list`).
- **Embedding (RAG):** `ollama pull nomic-embed-text` (lub inny z `VITE_OLLAMA_EMBEDDING_MODEL`).


## Build (Windows)

```bash
npm run tauri build
```

Instalatory: `src-tauri/target/release/bundle/msi/` oraz `nsis/`. Buildy **macOS/Linux** wykonuje się na odpowiednich runnerach z tym samym repozytorium.

## Struktura

- `src/pages/` — Dashboard, wgrywanie, streszczenie, fiszki, ustawienia, onboarding, brama Ollama
- `src/lib/` — Ollama API, SQLite (`@tauri-apps/plugin-sql`), RAG, prompty, eksport Quizlet (TSV)
- `src-tauri/src/commands.rs` — ekstrakcja PDF/PPTX, health-check Ollama (invoke)

## Design

Statyczne makiety HTML znajdują się w katalogu `Design/`.
