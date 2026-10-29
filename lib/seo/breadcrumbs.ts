import { generateBreadcrumbSchema, BreadcrumbItemInput } from "./schema";

export function getProductBreadcrumbs(categoryName: string, categorySlug: string, productName: string, productSlug: string) {
  const items: BreadcrumbItemInput[] = [
    { name: "Home", url: "/" },
    { name: "Products", url: "/products" },
    { name: categoryName, url: `/categories/${encodeURIComponent(categorySlug)}` },
    { name: productName, url: `/products/${encodeURIComponent(productSlug)}` },
  ];

  return {
    items,
    schema: generateBreadcrumbSchema(items),
  };
}

export function getCategoryBreadcrumbs(categoryName: string, categorySlug: string) {
  const items: BreadcrumbItemInput[] = [
    { name: "Home", url: "/" },
    { name: "Categories", url: "/categories" },
    { name: categoryName, url: `/categories/${encodeURIComponent(categorySlug)}` },
  ];

  return {
    items,
    schema: generateBreadcrumbSchema(items),
  };
}
