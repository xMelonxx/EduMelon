/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_FEEDBACK_SUPABASE_URL?: string;
  readonly VITE_FEEDBACK_SUPABASE_ANON_KEY?: string;
  readonly VITE_OLLAMA_URL?: string;
  readonly VITE_OLLAMA_MODEL_E2B_IT?: string;
  readonly VITE_OLLAMA_MODEL_E4B_IT?: string;
  readonly VITE_OLLAMA_EMBEDDING_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
