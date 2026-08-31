/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  readonly PUBLIC_RECEIPT_OCR_PROVIDER?: "local" | "google" | "local-first" | "google-first";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
