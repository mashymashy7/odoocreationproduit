import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — Atelier Odoo" },
      {
        name: "description",
        content:
          "Connectez-vous à Atelier pour transformer vos photos produits en fiches publiées sur votre boutique Odoo.",
      },
      { property: "og:title", content: "Connexion — Atelier Odoo" },
      {
        property: "og:description",
        content: "Accédez à votre espace de création de fiches produits Odoo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/" });
  }, [loading, session, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Compte créé. Vous pouvez commencer.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Connexion Google indisponible.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-primary font-[family-name:var(--font-display)] text-sm font-bold text-primary-foreground">
              A
            </span>
            <div>
              <p className="font-[family-name:var(--font-display)] text-base font-semibold">Atelier</p>
              <p className="label-mono">Photos → produits Odoo</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">
            {mode === "signin" ? "Se connecter" : "Créer un compte"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vos produits et votre connexion Odoo restent privés.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Un instant…" : mode === "signin" ? "Se connecter" : "Créer mon compte"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="label-mono">ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={google}>
            Continuer avec Google
          </Button>

          <button
            type="button"
            className="mt-5 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Pas encore de compte ? En créer un" : "J'ai déjà un compte"}
          </button>
        </div>
      </div>
    </main>
  );
}
