export type AppView = "receipts" | "bank";

export function appPath(path: `/${string}`, base = import.meta.env.BASE_URL) {
  const trimmedBase = base.replace(/^\/+|\/+$/g, "");
  return `${trimmedBase ? `/${trimmedBase}` : ""}${path}`;
}

export function viewFromPath(pathname: string): AppView {
  return pathname.replace(/\/+$/, "").endsWith("/bank") ? "bank" : "receipts";
}
