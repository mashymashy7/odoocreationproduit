import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { odooLogin, odooCall, fetchAsBase64 } from "./odoo.server";

type ConnInput = { url: string; db_name: string; username: string; api_key: string };

export const saveOdooConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ConnInput) => {
    const clean = {
      url: (input?.url ?? "").trim(),
      db_name: (input?.db_name ?? "").trim(),
      username: (input?.username ?? "").trim(),
      api_key: (input?.api_key ?? "").trim(),
    };
    if (!clean.url || !clean.db_name || !clean.username || !clean.api_key) {
      throw new Error("Tous les champs de connexion sont requis.");
    }
    return clean;
  })
  .handler(async ({ data, context }) => {
    const uid = await odooLogin(data);
    const company = await odooCall<{ id: number; name: string }[]>(
      data,
      uid,
      "res.users",
      "read",
      [[uid], ["name"]],
    );

    const { error } = await context.supabase.from("odoo_connections").upsert(
      {
        user_id: context.userId,
        ...data,
        status: "connected",
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error("Impossible d'enregistrer la connexion.");

    return { ok: true as const, account: company?.[0]?.name ?? data.username };
  });

export const publishProductToOdoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string }) => {
    if (!input?.productId) throw new Error("Produit introuvable.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("id", data.productId)
      .maybeSingle();
    if (!product) throw new Error("Produit introuvable.");

    const { data: conn } = await supabase
      .from("odoo_connections")
      .select("url, db_name, username, api_key")
      .maybeSingle();
    if (!conn) throw new Error("Connectez d'abord votre compte Odoo.");

    try {
      const uid = await odooLogin(conn);

      // Catégorie boutique (product.public.category) : réutilisée ou créée.
      let publicCategIds: number[] = [];
      const categoryName = (product.category || "").split("/").pop()?.trim();
      if (categoryName) {
        const found = await odooCall<number[]>(conn, uid, "product.public.category", "search", [
          [["name", "=", categoryName]],
        ]);
        publicCategIds = found?.length
          ? [found[0]!]
          : [
              await odooCall<number>(conn, uid, "product.public.category", "create", [
                { name: categoryName },
              ]),
            ];
      }

      let imageB64: string | null = null;
      const firstPath = product.images?.[0];
      if (firstPath) {
        const { data: signed } = await supabase.storage
          .from("product-photos")
          .createSignedUrl(firstPath, 300);
        if (signed?.signedUrl) imageB64 = await fetchAsBase64(signed.signedUrl);
      }

      const values: Record<string, unknown> = {
        name: product.title || "Nouveau produit",
        list_price: Number(product.price) || 0,
        description_sale: product.short_description || "",
        website_description: product.description || "",
        sale_ok: true,
        purchase_ok: true,
        type: "consu",
        is_published: true,
      };
      if (publicCategIds.length) values["public_categ_ids"] = [[6, 0, publicCategIds]];
      if (imageB64) values["image_1920"] = imageB64;

      const odooId = await odooCall<number>(conn, uid, "product.template", "create", [values]);

      // Photos supplémentaires en galerie produit.
      const extra = (product.images ?? []).slice(1, 5);
      for (const path of extra) {
        const { data: signed } = await supabase.storage
          .from("product-photos")
          .createSignedUrl(path, 300);
        if (!signed?.signedUrl) continue;
        await odooCall(conn, uid, "product.image", "create", [
          {
            name: product.title || "Photo",
            product_tmpl_id: odooId,
            image_1920: await fetchAsBase64(signed.signedUrl),
          },
        ]);
      }

      await supabase
        .from("products")
        .update({ status: "published", odoo_product_id: odooId, error_message: null })
        .eq("id", product.id);

      return { ok: true as const, odooId };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Publication impossible.";
      await supabase
        .from("products")
        .update({ status: "error", error_message: message })
        .eq("id", product.id);
      throw new Error(message);
    }
  });
