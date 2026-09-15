import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

const MAX_CONNECTIONS_PER_RUN = 5;

export const Route = createFileRoute("/api/public/hooks/drive-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { syncConnection } = await import("@/lib/drive-sync.server");

        const { data: connections, error } = await supabaseAdmin
          .from("drive_connections")
          .select("*")
          .eq("auto_sync", true)
          .eq("paused", false)
          .not("folder_id", "is", null)
          .limit(MAX_CONNECTIONS_PER_RUN);

        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        let created = 0;
        let failed = 0;
        let processed = 0;
        for (const conn of connections ?? []) {
          // Respecte la fréquence choisie par l'utilisateur.
          const interval = (conn.sync_interval_minutes ?? 15) * 60_000;
          const last = conn.last_sync_at ? Date.parse(conn.last_sync_at) : 0;
          if (last && Date.now() - last < interval) continue;

          processed += 1;
          const result = await syncConnection(supabaseAdmin, conn);
          created += result.created;
          failed += result.failed;
        }

        return new Response(
          JSON.stringify({ ok: true, accounts: processed, created, failed }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
