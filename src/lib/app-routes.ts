export type AppView = "dashboard" | "receipts" | "bank";

export function appPath(path: `/${string}`, base = import.meta.env.BASE_URL) {
  const trimmedBase = base.replace(/^\/+|\/+$/g, "");
  return `${trimmedBase ? `/${trimmedBase}` : ""}${path}`;
}

export function viewFromPath(pathname: string): AppView {
  const path = pathname.replace(/\/+$/, "");
  if (path.endsWith("/bank")) return "bank";
  if (path.endsWith("/dashboard")) return "dashboard";
  return "receipts";
}
