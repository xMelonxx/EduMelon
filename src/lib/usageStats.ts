import { MODEL_PROFILES } from "./constants";
import { saveUsageStatsToSupabase } from "./supabase";
import {
  getOrCreateInstallId,
  getUsageStatsConsent,
  loadLocalProfile,
} from "./storage";

/**
 * Aktualizuje `usage_stats.last_seen_at` przy starcie aplikacji,
 * ale tylko jeśli użytkownik wyraził zgodę w onboardingu.
 */
export async function syncUsageStatsIfConsented(): Promise<void> {
  if (!getUsageStatsConsent()) return;
  const p = loadLocalProfile();
  if (!p) return;
  const modelProfile = p.modelProfile;
  const model_tag = MODEL_PROFILES[modelProfile]?.ollamaTag ?? modelProfile;
  const res = await saveUsageStatsToSupabase({
    install_id: getOrCreateInstallId(),
    field_of_study: p.fieldOfStudy,
    model_profile: model_tag,
  });
  if (!res.ok) {
    // Nie blokujemy działania apki — to tylko analityka.
    console.warn("Nie udało się wysłać statystyk użycia:", res.error);
  }
}

