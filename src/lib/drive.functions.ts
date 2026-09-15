import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DriveStatus = {
  connected: boolean;
  email: string;
  folder_id: string | null;
  folder_name: string | null;
  auto_sync: boolean;
  paused: boolean;
  error_message: string | null;
  last_sync_at: string | null;
  sync_interval_minutes: number;
  max_products_per_run: number;
  auto_publish: boolean;
};

/** État de la liaison Google Drive de l'utilisateur. */
export const getDriveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriveStatus | null> => {
    const { data } = await context.supabase
      .from("drive_connections")
      .select(
        "email, folder_id, folder_name, auto_sync, paused, error_message, last_sync_at, sync_interval_minutes, max_products_per_run, auto_publish",
      )
      .maybeSingle();
    if (!data) return null;
    return { connected: true, ...data };
  });

/** Réglages personnalisés de la surveillance automatique. */
export const setDriveCronSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { intervalMinutes: number; maxProducts: number; autoPublish: boolean }) => {
      const interval = Math.round(Number(input?.intervalMinutes));
      const maxProducts = Math.round(Number(input?.maxProducts));
      if (!Number.isFinite(interval) || interval < 5 || interval > 1440)
        throw new Error("La fréquence doit être comprise entre 5 minutes et 24 heures.");
      if (!Number.isFinite(maxProducts) || maxProducts < 1 || maxProducts > 10)
        throw new Error("Le nombre de produits par passage doit être compris entre 1 et 10.");
      return { interval, maxProducts, autoPublish: !!input?.autoPublish };
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("drive_connections")
      .update({
        sync_interval_minutes: data.interval,
        max_products_per_run: data.maxProducts,
        auto_publish: data.autoPublish,
      })
      .eq("user_id", context.userId);
    if (error) throw new Error("Impossible d'enregistrer les réglages.");
    return { ok: true as const };
  });

/** Prépare l'URL de consentement Google. */
export const startDriveConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { buildAuthUrl } = await import("./drive.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const state = crypto.randomUUID();
    const { error } = await supabaseAdmin
      .from("drive_oauth_states")
      .insert({ state, user_id: context.userId });
    if (error) throw new Error("Impossible de démarrer la connexion Google.");

    const origin = new URL(getRequestUrl()).origin;
    return { url: buildAuthUrl(origin, state) };
  });

/** Dossiers Drive disponibles (racine ou contenu d'un dossier). */
export const listDriveFolders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { parentId?: string }) => ({ parentId: input?.parentId || "root" }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureAccessToken } = await import("./drive-sync.server");
    const { listSubfolders } = await import("./drive.server");

    const { data: conn } = await supabaseAdmin
      .from("drive_connections")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connectez d'abord votre compte Google Drive.");

    const token = await ensureAccessToken(supabaseAdmin, conn);
    return { folders: await listSubfolders(token, data.parentId) };
  });

/** Choisit le dossier surveillé. */
export const setDriveFolder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { folderId: string; folderName: string }) => {
    if (!input?.folderId) throw new Error("Sélectionnez un dossier.");
    return { folderId: input.folderId, folderName: input.folderName || "Dossier" };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("drive_connections")
      .update({ folder_id: data.folderId, folder_name: data.folderName })
      .eq("user_id", context.userId);
    if (error) throw new Error("Impossible d'enregistrer le dossier.");
    return { ok: true as const };
  });

/** Active ou désactive la surveillance automatique. */
export const setDriveAutoSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { enabled: boolean }) => ({ enabled: !!input?.enabled }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("drive_connections")
      .update({
        auto_sync: data.enabled,
        paused: false,
        status: "connected",
        error_message: null,
      })
      .eq("user_id", context.userId);
    if (error) throw new Error("Impossible de modifier la surveillance.");
    return { ok: true as const, enabled: data.enabled };
  });

/** Coupe la liaison Google Drive. */
export const disconnectDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("drive_connections").delete().eq("user_id", context.userId);
    return { ok: true as const };
  });

/** Lance une vérification immédiate du dossier surveillé. */
export const runDriveSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncConnection } = await import("./drive-sync.server");

    const { data: conn } = await supabaseAdmin
      .from("drive_connections")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!conn) throw new Error("Connectez d'abord votre compte Google Drive.");
    if (!conn.folder_id) throw new Error("Choisissez d'abord le dossier à surveiller.");

    return syncConnection(supabaseAdmin, conn, 3);
  });
