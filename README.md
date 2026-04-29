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

## Supabase (opcjonalnie: statystyki i feedback)

1. Utwórz projekt w [Supabase](https://supabase.com/).
2. W SQL Editor wykonaj:

```sql
create table public.usage_stats (
  install_id uuid primary key,
  field_of_study text not null,
  model_profile text not null,
  created_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

alter table public.usage_stats enable row level security;

create policy "Allow anon insert"
  on public.usage_stats for insert
  to anon
  with check (true);

create policy "Allow anon update"
  on public.usage_stats for update
  to anon
  using (true)
  with check (true);
```

3. (Opcjonalnie) Dodaj feedback + załączniki (production-safe):

```sql
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('bug', 'suggestion', 'idea')),
  message text not null,
  contact text,
  install_id text,
  app_version text,
  model_profile text,
  os text,
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;
grant usage on schema public to anon;
grant insert on table public.feedback to anon;

create policy "anon_insert_feedback"
  on public.feedback for insert
  to anon
  with check (true);

create table if not exists public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback(id) on delete cascade,
  file_path text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);

alter table public.feedback_attachments enable row level security;
grant insert on table public.feedback_attachments to anon;

create policy "anon_insert_feedback_attachments"
  on public.feedback_attachments for insert
  to anon
  with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  5242880,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "anon_insert_feedback_attachments_objects"
  on storage.objects for insert
  to anon
  with check (
    bucket_id = 'feedback-attachments'
    and name like 'feedback/%'
  );
```

4. Skopiuj URL projektu i anon key do `.env`:
   - wspólna baza (statystyki + feedback):
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`
   - osobna baza tylko dla feedbacku (zalecane, jeśli chcesz wygodnie przeglądać zgłoszenia w innym narzędziu):
     - `VITE_FEEDBACK_SUPABASE_URL`
     - `VITE_FEEDBACK_SUPABASE_ANON_KEY`

Dostosuj polityki RLS do własnych wymagań bezpieczeństwa (powyżej to minimalny przykład na MVP). Aplikacja wysyła tylko anonimowe: `install_id`, `field_of_study`, `model_profile`, `last_seen_at`.

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
