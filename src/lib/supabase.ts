import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client, used for storage.
 *
 * This holds the secret key, which ignores every access rule in the project.
 * It must never be imported into a client component. The browser only ever
 * receives a short-lived signed URL produced by this client.
 */

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SECRET_KEY &&
      process.env.SUPABASE_STORAGE_BUCKET,
  );
}

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "statements";

// Created lazily so a missing environment variable surfaces as a clear error
// at the point of use, rather than crashing the whole app at import time.
export function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("Supabase storage is not configured.");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  }).storage.from(STORAGE_BUCKET);
}

/**
 * `createSignedUploadUrl` returns an absolute URL in current versions, but has
 * returned a storage-relative path before. Normalising here means the client
 * always gets something it can PUT to directly.
 */
export function absoluteStorageUrl(signedUrl: string): string {
  if (signedUrl.startsWith("http")) return signedUrl;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${
    signedUrl.startsWith("/") ? "" : "/"
  }${signedUrl}`;
}
