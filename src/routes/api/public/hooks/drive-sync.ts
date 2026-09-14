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
        for (const conn of connections ?? []) {
          const result = await syncConnection(supabaseAdmin, conn, 3);
          created += result.created;
          failed += result.failed;
        }

        return new Response(
          JSON.stringify({ ok: true, accounts: connections?.length ?? 0, created, failed }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
