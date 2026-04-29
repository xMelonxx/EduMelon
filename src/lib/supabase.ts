import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const feedbackUrl = import.meta.env.VITE_FEEDBACK_SUPABASE_URL as
  | string
  | undefined;
const feedbackAnon = import.meta.env.VITE_FEEDBACK_SUPABASE_ANON_KEY as
  | string
  | undefined;

let client: SupabaseClient | null = null;
let feedbackClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!url || !anon) return null;
  if (!client) {
    client = createClient(url, anon);
  }
  return client;
}

export function getFeedbackSupabase(): SupabaseClient | null {
  const effectiveUrl = feedbackUrl ?? url;
  const effectiveAnon = feedbackAnon ?? anon;
  if (!effectiveUrl || !effectiveAnon) return null;
  if (!feedbackClient) {
    feedbackClient = createClient(effectiveUrl, effectiveAnon);
  }
  return feedbackClient;
}

export type UsageStatsRow = {
  install_id: string;
  field_of_study: string;
  model_profile: string;
  last_seen_at?: string;
};

export type FeedbackType = "bug" | "suggestion" | "idea";

export type FeedbackRow = {
  id?: string;
  type: FeedbackType;
  message: string;
  contact?: string;
  install_id?: string;
  app_version?: string;
  model_profile?: string;
  os?: string;
  created_at?: string;
};

export type FeedbackAttachmentRow = {
  feedback_id: string;
  file_path: string;
  mime_type: string;
  size_bytes: number;
};

const FEEDBACK_ATTACHMENTS_BUCKET = "feedback-attachments";
const MAX_FEEDBACK_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_FEEDBACK_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export async function saveUsageStatsToSupabase(
  row: UsageStatsRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getSupabase();
  if (!sb) {
    console.warn("Supabase nie skonfigurowany — pomijam zapis w chmurze.");
    return { ok: false, error: "Supabase nie jest skonfigurowany (.env)." };
  }
  const { error } = await sb.from("usage_stats").upsert(
    {
      install_id: row.install_id,
      field_of_study: row.field_of_study,
      model_profile: row.model_profile,
      last_seen_at: row.last_seen_at ?? new Date().toISOString(),
    },
    { onConflict: "install_id" },
  );
  if (error) {
    console.error("Supabase usage_stats:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function saveFeedbackToSupabase(
  row: FeedbackRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getFeedbackSupabase();
  if (!sb) {
    return {
      ok: false,
      error:
        "Supabase nie jest skonfigurowany (.env). Ustaw VITE_FEEDBACK_SUPABASE_* lub VITE_SUPABASE_*.",
    };
  }
  const { error } = await sb.from("feedback").insert({
    type: row.type,
    message: row.message.trim(),
    contact: row.contact?.trim() || null,
    install_id: row.install_id ?? null,
    app_version: row.app_version ?? null,
    model_profile: row.model_profile ?? null,
    os: row.os ?? null,
    created_at: row.created_at ?? new Date().toISOString(),
  });
  if (error) {
    console.error("Supabase feedback:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export async function saveFeedbackWithAttachmentsToSupabase(
  row: FeedbackRow,
  files: File[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = getFeedbackSupabase();
  if (!sb) {
    return {
      ok: false,
      error:
        "Supabase nie jest skonfigurowany (.env). Ustaw VITE_FEEDBACK_SUPABASE_* lub VITE_SUPABASE_*.",
    };
  }
  const feedbackId = row.id ?? crypto.randomUUID();
  const createdAt = row.created_at ?? new Date().toISOString();

  const { error: feedbackError } = await sb.from("feedback").insert({
    id: feedbackId,
    type: row.type,
    message: row.message.trim(),
    contact: row.contact?.trim() || null,
    install_id: row.install_id ?? null,
    app_version: row.app_version ?? null,
    model_profile: row.model_profile ?? null,
    os: row.os ?? null,
    created_at: createdAt,
  });
  if (feedbackError) {
    return { ok: false, error: feedbackError.message };
  }

  if (!files.length) return { ok: true };

  const attachmentRows: FeedbackAttachmentRow[] = [];
  for (const file of files) {
    if (!ALLOWED_FEEDBACK_MIME_TYPES.has(file.type)) {
      return { ok: false, error: `Niedozwolony typ pliku: ${file.name}` };
    }
    if (file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) {
      return { ok: false, error: `Plik jest za duży (max 5 MB): ${file.name}` };
    }
    const safeName = sanitizeFileName(file.name || "image");
    const path = `feedback/${feedbackId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await sb.storage
      .from(FEEDBACK_ATTACHMENTS_BUCKET)
      .upload(path, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) {
      return { ok: false, error: `Upload zdjęcia nieudany: ${uploadError.message}` };
    }
    attachmentRows.push({
      feedback_id: feedbackId,
      file_path: path,
      mime_type: file.type,
      size_bytes: file.size,
    });
  }

  const { error: attachmentsError } = await sb
    .from("feedback_attachments")
    .insert(attachmentRows);
  if (attachmentsError) {
    return { ok: false, error: attachmentsError.message };
  }
  return { ok: true };
}
