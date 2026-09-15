import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles, Trash2, UploadCloud, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { analyzeProductPhotos } from "@/lib/ai.functions";
import { publishProductToOdoo } from "@/lib/odoo.functions";
import { OdooConnectionDialog, type OdooConnection } from "@/components/OdooConnectionDialog";
import { DrivePanel } from "@/components/DrivePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atelier — Vos photos deviennent des produits Odoo" },
      {
        name: "description",
        content:
          "Importez vos photos, l'IA rédige la fiche produit complète et la publie directement dans la boutique en ligne Odoo.",
      },
      { property: "og:title", content: "Atelier — Vos photos deviennent des produits Odoo" },
      {
        property: "og:description",
        content:
          "Importez vos photos, l'IA rédige la fiche produit et la publie dans votre boutique Odoo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Workspace,
});

type Photo = { path: string; url: string };

type ProductRow = {
  id: string;
  title: string;
  short_description: string;
  description: string;
  price: number;
  category: string;
  tags: string[];
  images: string[];
  analysis: string;
  status: string;
  odoo_product_id: number | null;
  error_message: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  published: "Publié",
  error: "Erreur",
};

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "published"
      ? "bg-success/12 text-success"
      : status === "error"
        ? "bg-destructive/12 text-destructive"
        : "bg-warning/15 text-warning";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Workspace() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const analyze = useServerFn(analyzeProductPhotos);
  const publish = useServerFn(publishProductToOdoo);

  const [connection, setConnection] = useState<OdooConnection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [history, setHistory] = useState<ProductRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  const loadConnection = useCallback(async () => {
    const { data } = await supabase
      .from("odoo_connections")
      .select("url, db_name, username, status")
      .maybeSingle();
    setConnection(data ?? null);
  }, []);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory((data ?? []) as ProductRow[]);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadConnection();
    loadHistory();
    const channel = supabase
      .channel("products-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        loadHistory();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadConnection, loadHistory]);

  const signPaths = useCallback(async (paths: string[]): Promise<Photo[]> => {
    if (!paths.length) return [];
    const { data } = await supabase.storage.from("product-photos").createSignedUrls(paths, 3600);
    return (data ?? [])
      .filter((s) => s.signedUrl)
      .map((s, i) => ({ path: paths[i]!, url: s.signedUrl as string }));
  }, []);

  async function onFiles(files: FileList | null) {
    if (!files?.length || !user) return;
    setUploading(true);
    try {
      const added: Photo[] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("product-photos").upload(path, file);
        if (error) {
          toast.error(`Import impossible : ${file.name}`);
          continue;
        }
        added.push(path as unknown as Photo);
      }
      const signed = await signPaths(added as unknown as string[]);
      setPhotos((prev) => [...prev, ...signed].slice(0, 5));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function removePhoto(path: string) {
    setPhotos((prev) => prev.filter((p) => p.path !== path));
    supabase.storage.from("product-photos").remove([path]);
  }

  async function runAnalysis() {
    if (!photos.length || !user) return;
    setAnalyzing(true);
    try {
      const draft = await analyze({ data: { paths: photos.map((p) => p.path) } });
      const { data, error } = await supabase
        .from("products")
        .insert({ ...draft, user_id: user.id, images: photos.map((p) => p.path), status: "draft" })
        .select("*")
        .single();
      if (error) throw error;
      setProduct(data as ProductRow);
      toast.success("Fiche produit générée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "L'analyse a échoué.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveDraft(silent = false) {
    if (!product) return;
    const { error } = await supabase
      .from("products")
      .update({
        title: product.title,
        short_description: product.short_description,
        description: product.description,
        price: product.price,
        category: product.category,
        tags: product.tags,
      })
      .eq("id", product.id);
    if (error) toast.error("Enregistrement impossible.");
    else if (!silent) toast.success("Brouillon enregistré");
  }

  async function publishNow() {
    if (!product) return;
    if (!connection) {
      setDialogOpen(true);
      return;
    }
    setPublishing(true);
    try {
      await saveDraft(true);
      const res = await publish({ data: { productId: product.id } });
      setProduct({ ...product, status: "published", odoo_product_id: res.odooId });
      toast.success("Produit publié sur votre boutique Odoo");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publication impossible.");
      setProduct({ ...product, status: "error" });
    } finally {
      setPublishing(false);
    }
  }

  async function openProduct(row: ProductRow) {
    setProduct(row);
    setPhotos(await signPaths(row.images ?? []));
  }

  function resetSheet() {
    setProduct(null);
    setPhotos([]);
  }

  const connected = connection?.status === "connected";
  const initials = useMemo(
    () => (user?.email ?? "?").slice(0, 2).toUpperCase(),
    [user?.email],
  );

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-primary font-[family-name:var(--font-display)] text-sm font-bold text-primary-foreground">
              A
            </span>
            <div className="leading-tight">
              <p className="font-[family-name:var(--font-display)] text-sm font-semibold">Atelier</p>
              <p className="label-mono">Photos → produits Odoo</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium"
            >
              <span
                className={`size-1.5 rounded-full ${connected ? "bg-success" : "bg-muted-foreground"}`}
              />
              <span className="hidden sm:inline">
                {connected ? `Odoo · ${connection?.db_name}` : "Connecter Odoo"}
              </span>
              <span className="sm:hidden">Odoo</span>
            </button>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/auth" });
              }}
              title="Se déconnecter"
              className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
            >
              {initials}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-12">
        {/* Colonne photos + historique */}
        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Photos du produit</h2>
              <span className="label-mono">{photos.length} / 5</span>
            </div>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />

            {photos.length === 0 ? (
              <button
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="mt-3 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-10 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {uploading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <UploadCloud className="size-5" />
                )}
                Importer vos photos produit
                <span className="text-xs">JPG ou PNG · 5 photos maximum</span>
              </button>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {photos.map((p) => (
                  <div key={p.path} className="group relative aspect-square overflow-hidden rounded-lg">
                    <img
                      src={p.url}
                      alt="Photo du produit importée"
                      className="size-full object-cover"
                      loading="lazy"
                    />
                    <button
                      onClick={() => removePhoto(p.path)}
                      className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-background/90 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Retirer la photo"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                {photos.length < 5 && (
                  <button
                    onClick={() => fileInput.current?.click()}
                    disabled={uploading}
                    className="grid aspect-square place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                  </button>
                )}
              </div>
            )}

            <Button
              className="mt-4 w-full"
              onClick={runAnalysis}
              disabled={!photos.length || analyzing}
            >
              {analyzing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Analyse des photos…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> Analyser et rédiger la fiche
                </>
              )}
            </Button>
          </section>

          <DrivePanel onProductsChanged={loadHistory} />

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between px-4 pt-4">
              <h2 className="text-sm font-semibold">Produits créés</h2>
              <span className="label-mono">{history.length}</span>
            </div>
            {history.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Vos fiches apparaîtront ici dès la première analyse.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {history.map((row) => (
                  <li key={row.id}>
                    <button
                      onClick={() => openProduct(row)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-secondary/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {row.title || "Fiche sans titre"}
                        </p>
                        <p className="label-mono">
                          {new Date(row.created_at).toLocaleString("fr-FR")}
                        </p>
                      </div>
                      <StatusChip status={row.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Colonne fiche produit */}
        <div className="lg:col-span-7">
          {!product ? (
            <section className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
              <Sparkles className="size-6 text-muted-foreground" />
              <h2 className="mt-3 text-base font-semibold">Aucune fiche en cours</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Importez les photos d'un produit, lancez l'analyse, puis relisez la fiche avant de la
                publier sur votre boutique Odoo.
              </p>
            </section>
          ) : (
            <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="label-mono">Fiche générée</p>
                  <h1 className="mt-1 text-xl font-semibold">
                    {product.title || "Nouvelle fiche produit"}
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip status={product.status} />
                  <button
                    onClick={resetSheet}
                    className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary"
                    aria-label="Fermer la fiche"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              {product.analysis && (
                <p className="mt-4 rounded-lg bg-secondary p-3 text-sm leading-relaxed text-secondary-foreground">
                  {product.analysis}
                </p>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="title">Titre</Label>
                  <Input
                    id="title"
                    value={product.title}
                    onChange={(e) => setProduct({ ...product, title: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="short">Accroche</Label>
                  <Input
                    id="short"
                    value={product.short_description}
                    onChange={(e) => setProduct({ ...product, short_description: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="desc">Description boutique</Label>
                  <Textarea
                    id="desc"
                    rows={6}
                    value={product.description}
                    onChange={(e) => setProduct({ ...product, description: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price">Prix (€)</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    value={product.price}
                    onChange={(e) => setProduct({ ...product, price: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cat">Catégorie boutique</Label>
                  <Input
                    id="cat"
                    value={product.category}
                    onChange={(e) => setProduct({ ...product, category: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="tags">Mots-clés (séparés par une virgule)</Label>
                  <Input
                    id="tags"
                    value={product.tags.join(", ")}
                    onChange={(e) =>
                      setProduct({
                        ...product,
                        tags: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
              </div>

              {product.status === "error" && product.error_message && (
                <p className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {product.error_message}
                </p>
              )}

              {product.status === "published" && product.odoo_product_id && (
                <p className="mt-4 rounded-lg bg-success/10 p-3 text-sm text-success">
                  Produit créé dans Odoo (référence interne {product.odoo_product_id}) et publié sur
                  la boutique en ligne.
                </p>
              )}

              <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {connected
                    ? `Destination : ${connection?.url}`
                    : "Aucun compte Odoo connecté pour l'instant."}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => saveDraft()}>
                    Enregistrer
                  </Button>
                  <Button onClick={publishNow} disabled={publishing}>
                    {publishing ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Publication…
                      </>
                    ) : (
                      "Publier sur Odoo"
                    )}
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      <OdooConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={connection}
        onSaved={loadConnection}
      />
    </div>
  );
}
