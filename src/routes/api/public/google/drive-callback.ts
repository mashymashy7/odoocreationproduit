import { createFileRoute } from "@tanstack/react-router";

function page(title: string, body: string) {
  return new Response(
    `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="font-family:system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#faf7f2;color:#1d1a17">
<div style="max-width:28rem;padding:2rem;text-align:center">
<h1 style="font-size:1.15rem;margin:0 0 .5rem">${title}</h1>
<p style="margin:0;color:#6b635a">${body}</p>
<p style="margin-top:1.5rem"><a href="/" style="color:#b4522f">Retour à l'application</a></p>
</div>
<script>setTimeout(function(){ if (window.opener) { window.opener.postMessage({ type: "drive-connected" }, window.location.origin); window.close(); } }, 800);</script>
</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/google/drive-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (url.searchParams.get("error") || !code || !state) {
          return page("Connexion Google annulée", "Vous pouvez réessayer depuis l'application.");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { exchangeCodeForTokens, fetchGoogleEmail } = await import("@/lib/drive.server");

        const { data: stateRow } = await supabaseAdmin
          .from("drive_oauth_states")
          .select("user_id, created_at")
          .eq("state", state)
          .maybeSingle();
        if (!stateRow) {
          return page("Lien expiré", "Relancez la connexion Google Drive depuis l'application.");
        }
        await supabaseAdmin.from("drive_oauth_states").delete().eq("state", state);

        try {
          const tokens = await exchangeCodeForTokens(code, url.origin);
          const email = await fetchGoogleEmail(tokens.access_token!);

          const { data: existing } = await supabaseAdmin
            .from("drive_connections")
            .select("refresh_token")
            .eq("user_id", stateRow.user_id)
            .maybeSingle();

          const { error } = await supabaseAdmin.from("drive_connections").upsert(
            {
              user_id: stateRow.user_id,
              email,
              access_token: tokens.access_token!,
              refresh_token: tokens.refresh_token || existing?.refresh_token || "",
              token_expires_at: new Date(
                Date.now() + (tokens.expires_in ?? 3600) * 1000,
              ).toISOString(),
              status: "connected",
              paused: false,
              error_message: null,
            },
            { onConflict: "user_id" },
          );
          if (error) throw new Error(error.message);

          return page(
            "Google Drive est connecté",
            `Compte ${email || "Google"} relié. Vous pouvez fermer cette fenêtre.`,
          );
        } catch (e) {
          return page(
            "Connexion impossible",
            e instanceof Error ? e.message : "Réessayez depuis l'application.",
          );
        }
      },
    },
  },
});
