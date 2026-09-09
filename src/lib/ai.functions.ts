import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductDraft = {
  title: string;
  short_description: string;
  description: string;
  price: number;
  category: string;
  tags: string[];
  analysis: string;
};

const SYSTEM = `Tu es un expert e-commerce et merchandising. À partir de photos, tu identifies le produit
(matière, forme, usage, finition, public cible) et tu rédiges une fiche produit vendeuse en français,
prête à être publiée sur une boutique en ligne Odoo. Tu réponds uniquement en json valide.`;

const INSTRUCTION = `Analyse ces photos d'un même produit et renvoie un objet json avec exactement ces clés :
"title" (nom commercial court, max 70 caractères),
"short_description" (accroche d'une phrase, max 160 caractères),
"description" (description riche en HTML simple : quelques <p>, une <ul> de caractéristiques),
"price" (nombre, prix de vente conseillé en euros TTC, cohérent avec le marché),
"category" (catégorie boutique, ex: "Décoration / Vases"),
"tags" (tableau de 3 à 6 mots-clés),
"analysis" (2 à 4 phrases expliquant ton raisonnement : ce que tu as reconnu et pourquoi ce positionnement).`;

export const analyzeProductPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { paths: string[] }) => {
    if (!input?.paths?.length) throw new Error("Ajoutez au moins une photo.");
    return { paths: input.paths.slice(0, 5) };
  })
  .handler(async ({ data, context }): Promise<ProductDraft> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Le service d'analyse n'est pas configuré.");

    const { data: signed, error } = await context.supabase.storage
      .from("product-photos")
      .createSignedUrls(data.paths, 600);
    if (error || !signed) throw new Error("Impossible de lire les photos.");

    const images = signed
      .filter((s) => s.signedUrl)
      .map((s) => ({ type: "image_url", image_url: { url: s.signedUrl as string } }));
    if (!images.length) throw new Error("Impossible de lire les photos.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-5.6-sol",
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: [{ type: "text", text: INSTRUCTION }, ...images] },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Trop de demandes d'analyse. Réessayez dans un instant.");
      if (res.status === 402)
        throw new Error("Les crédits d'analyse sont épuisés. Rechargez votre espace Lovable.");
      throw new Error(`L'analyse a échoué (${res.status}). ${body.slice(0, 200)}`);
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("L'analyse n'a rien renvoyé. Réessayez.");

    let parsed: Partial<ProductDraft>;
    try {
      parsed = JSON.parse(content) as Partial<ProductDraft>;
    } catch {
      throw new Error("Réponse d'analyse illisible. Réessayez.");
    }

    return {
      title: String(parsed.title ?? "").slice(0, 120),
      short_description: String(parsed.short_description ?? "").slice(0, 300),
      description: String(parsed.description ?? ""),
      price: Number(parsed.price) > 0 ? Number(parsed.price) : 0,
      category: String(parsed.category ?? ""),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 8) : [],
      analysis: String(parsed.analysis ?? ""),
    };
  });
