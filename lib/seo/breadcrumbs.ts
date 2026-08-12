import { generateBreadcrumbSchema, BreadcrumbItemInput } from "./schema";

export function getProductBreadcrumbs(categoryName: string, categorySlug: string, productName: string) {
  const items: BreadcrumbItemInput[] = [
    { name: "Home", url: "/" },
    { name: "Products", url: "/products" },
    { name: categoryName, url: `/categories/${categorySlug}` },
    { name: productName, url: "#" },
  ];

  return {
    items,
    schema: generateBreadcrumbSchema(items),
  };
}

export function getCategoryBreadcrumbs(categoryName: string) {
  const items: BreadcrumbItemInput[] = [
    { name: "Home", url: "/" },
    { name: "Categories", url: "/categories" },
    { name: categoryName, url: "#" },
  ];

  return {
    items,
    schema: generateBreadcrumbSchema(items),
  };
}