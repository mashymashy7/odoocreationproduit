import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProductDraft } from "./ai.server";

export type { ProductDraft };

/** Analyse manuelle des photos importées depuis l'application. */
export const analyzeProductPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { paths: string[] }) => {
    if (!input?.paths?.length) throw new Error("Ajoutez au moins une photo.");
    return { paths: input.paths.slice(0, 5) };
  })
  .handler(async ({ data, context }): Promise<ProductDraft> => {
    const { generateProductDraft } = await import("./ai.server");

    const { data: signed, error } = await context.supabase.storage
      .from("product-photos")
      .createSignedUrls(data.paths, 600);
    if (error || !signed) throw new Error("Impossible de lire les photos.");

    const urls = signed.map((s) => s.signedUrl).filter(Boolean) as string[];
    if (!urls.length) throw new Error("Impossible de lire les photos.");

    return generateProductDraft(urls);
  });
