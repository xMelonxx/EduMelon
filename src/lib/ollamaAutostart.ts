import { Command } from "@tauri-apps/plugin-shell";
import { ollamaTagsReachable } from "./ollama";

const WAIT_MS = 850;
const MAX_TRIES = 14; // ~12s

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Próbuje uruchomić Ollamę lokalnie (jeśli jest zainstalowana),
 * a potem czeka aż API odpowie na `/api/tags`.
 *
 * Zwraca `true` jeśli Ollama działa, `false` jeśli nie udało się jej uruchomić / wykryć.
 */
export async function ensureOllamaRunning(): Promise<boolean> {
  if (await ollamaTagsReachable()) return true;

  // Best effort — jeśli `ollama` nie jest w PATH albo jest już uruchomiona, po prostu olej.
  try {
    // Konfiguracja komendy jest w Tauri capabilities (shell scope) pod nazwą "ollama".
    // `ollama serve` utrzymuje proces, więc spawn i nie czekamy na zakończenie.
    void Command.create("ollama", ["serve"]).spawn();
  } catch {
    // no-op
  }

  for (let i = 0; i < MAX_TRIES; i++) {
    if (await ollamaTagsReachable()) return true;
    await sleep(WAIT_MS);
  }
  return false;
}

