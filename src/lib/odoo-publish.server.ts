import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { odooLogin, odooCall, fetchAsBase64, type OdooCredentials } from "./odoo.server";

type Db = SupabaseClient<Database>;

export type PublishableProduct = {
  id: string;
  title: string;
  short_description: string;
  description: string;
  price: number;
  category: string;
  images: string[];
};

/** Crée le produit dans Odoo (e-commerce) et met à jour son statut local. */
export async function publishProduct(
  supabase: Db,
  product: PublishableProduct,
  conn: OdooCredentials,
): Promise<number> {
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
    for (const path of (product.images ?? []).slice(1, 5)) {
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

    return odooId;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Publication impossible.";
    await supabase
      .from("products")
      .update({ status: "error", error_message: message })
      .eq("id", product.id);
    throw new Error(message);
  }
}
