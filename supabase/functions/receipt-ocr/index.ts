import { createReceiptOcrHandler } from "./handler.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function supabaseApiKey() {
  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacyKey) return legacyKey;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}") as Record<string, string>;
    return Object.values(keys)[0] ?? "";
  } catch {
    return "";
  }
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const apiKey = supabaseApiKey();

async function authorize(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ") || !supabaseUrl || !apiKey) return false;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: apiKey },
    });
    return response.ok;
  } catch {
    return false;
  }
}

Deno.serve(createReceiptOcrHandler({
  authorize,
  fetchGoogle: fetch,
  visionApiKey: Deno.env.get("GOOGLE_VISION_API_KEY") ?? "",
}));
