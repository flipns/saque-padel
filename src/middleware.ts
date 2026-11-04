import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return response;
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Solo refresca el token si ha caducado. No hace llamada de red en cada petición (las páginas verifican la sesión).
  if (request.cookies.getAll().some((c) => c.name.includes("-auth-token"))) await sb.auth.getSession();
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|brand|favicon.ico).*)"] };
