import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AiBlockedError, generateProductDraft } from "./ai.server";
import { publishProduct } from "./odoo-publish.server";
import {
  downloadDriveFile,
  listImagesInFolder,
  listSubfolders,
  refreshAccessToken,
} from "./drive.server";

type Db = SupabaseClient<Database>;

export type DriveConnectionRow = {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
  folder_id: string | null;
  folder_name: string | null;
  auto_sync: boolean;
  paused: boolean;
  lock_until: string | null;
  sync_interval_minutes?: number | null;
  max_products_per_run?: number | null;
  auto_publish?: boolean | null;
  last_sync_at?: string | null;
};

/** Renvoie un jeton d'accès valide, en le rafraîchissant si besoin. */
export async function ensureAccessToken(admin: Db, conn: DriveConnectionRow): Promise<string> {
  const expires = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  if (conn.access_token && expires > Date.now() + 60_000) return conn.access_token;
  if (!conn.refresh_token) throw new Error("Reconnectez votre compte Google Drive.");

  const tokens = await refreshAccessToken(conn.refresh_token);
  const accessToken = tokens.access_token!;
  await admin
    .from("drive_connections")
    .update({
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      status: "connected",
    })
    .eq("id", conn.id);
  conn.access_token = accessToken;
  return accessToken;
}

const LOCK_MINUTES = 10;

/** Verrou simple pour éviter deux synchronisations simultanées du même compte. */
async function acquireLock(admin: Db, conn: DriveConnectionRow): Promise<boolean> {
  const now = Date.now();
  if (conn.lock_until && Date.parse(conn.lock_until) > now) return false;
  const { data } = await admin
    .from("drive_connections")
    .update({ lock_until: new Date(now + LOCK_MINUTES * 60_000).toISOString() })
    .eq("id", conn.id)
    .or(`lock_until.is.null,lock_until.lt.${new Date(now).toISOString()}`)
    .select("id");
  return !!data?.length;
}

async function releaseLock(admin: Db, conn: DriveConnectionRow) {
  await admin
    .from("drive_connections")
    .update({ lock_until: null, last_sync_at: new Date().toISOString() })
    .eq("id", conn.id);
}

async function pause(admin: Db, conn: DriveConnectionRow, message: string) {
  await admin
    .from("drive_connections")
    .update({ paused: true, status: "paused", error_message: message, lock_until: null })
    .eq("id", conn.id);
}

/**
 * Traite les nouveaux sous-dossiers du dossier surveillé : un sous-dossier = un produit.
 * Bornée à `maxFolders` par exécution.
 */
export async function syncConnection(
  admin: Db,
  conn: DriveConnectionRow,
  maxFolders = 3,
): Promise<{ created: number; failed: number; message?: string }> {
  if (!conn.folder_id) return { created: 0, failed: 0, message: "Aucun dossier surveillé." };
  if (!(await acquireLock(admin, conn))) {
    return { created: 0, failed: 0, message: "Une synchronisation est déjà en cours." };
  }

  let created = 0;
  let failed = 0;

  try {
    const token = await ensureAccessToken(admin, conn);
    const folders = await listSubfolders(token, conn.folder_id);

    const { data: odooConn } = await admin
      .from("odoo_connections")
      .select("url, db_name, username, api_key")
      .eq("user_id", conn.user_id)
      .maybeSingle();

    for (const folder of folders) {
      if (created + failed >= maxFolders) break;

      // Marquage idempotent : la contrainte d'unicité empêche tout doublon.
      const { data: claim } = await admin
        .from("drive_synced_folders")
        .insert({
          user_id: conn.user_id,
          folder_id: folder.id,
          folder_name: folder.name,
          status: "processing",
        })
        .select("id")
        .maybeSingle();
      if (!claim) continue; // déjà traité

      try {
        const images = await listImagesInFolder(token, folder.id);
        if (!images.length) {
          await admin
            .from("drive_synced_folders")
            .update({ status: "skipped", error_message: "Aucune photo dans ce dossier." })
            .eq("id", claim.id);
          continue;
        }

        const paths: string[] = [];
        for (const image of images.slice(0, 5)) {
          const bytes = await downloadDriveFile(token, image.id);
          const ext = (image.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
          const path = `${conn.user_id}/${folder.id}-${image.id}.${ext}`;
          const { error } = await admin.storage
            .from("product-photos")
            .upload(path, bytes, { contentType: image.mimeType, upsert: true });
          if (!error) paths.push(path);
        }
        if (!paths.length) throw new Error("Les photos n'ont pas pu être importées.");

        const { data: signed } = await admin.storage
          .from("product-photos")
          .createSignedUrls(paths, 600);
        const urls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean) as string[];

        const draft = await generateProductDraft(urls);

        const { data: product, error: insertError } = await admin
          .from("products")
          .insert({
            ...draft,
            title: draft.title || folder.name,
            user_id: conn.user_id,
            images: paths,
            status: "draft",
          })
          .select("*")
          .single();
        if (insertError || !product) throw new Error("Fiche produit non enregistrée.");

        await admin
          .from("drive_synced_folders")
          .update({ product_id: product.id, status: "created" })
          .eq("id", claim.id);

        if (odooConn) {
          await publishProduct(admin, product, odooConn);
          await admin
            .from("drive_synced_folders")
            .update({ status: "published" })
            .eq("id", claim.id);
        }
        created += 1;
      } catch (e) {
        failed += 1;
        const message = e instanceof Error ? e.message : "Traitement impossible.";
        await admin
          .from("drive_synced_folders")
          .update({ status: "error", error_message: message })
          .eq("id", claim.id);
        if (e instanceof AiBlockedError && (e.status === 402 || e.status === 403)) {
          await pause(admin, conn, message);
          return { created, failed, message };
        }
      }
    }

    await releaseLock(admin, conn);
    return { created, failed };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Synchronisation impossible.";
    await admin
      .from("drive_connections")
      .update({ error_message: message, lock_until: null })
      .eq("id", conn.id);
    return { created, failed, message };
  }
}
