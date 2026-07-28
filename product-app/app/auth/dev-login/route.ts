import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

function getSafeNext(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");

  if (next?.startsWith("/") && !next.startsWith("//")) {
    return next;
  }

  return "/dashboard";
}

export async function GET(request: NextRequest) {
  const isLocalHost =
    request.nextUrl.hostname === "localhost" ||
    request.nextUrl.hostname === "127.0.0.1";
  if (
    (process.env.NODE_ENV === "production" && !isLocalHost) ||
    process.env.DEV_LOGIN_ENABLED !== "true"
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const { url, anonKey } = getSupabaseConfig();

  if (!url || !anonKey) {
    return NextResponse.redirect(
      new URL("/login?error=dev_login_failed", request.url),
      { status: 303 },
    );
  }

  let response = NextResponse.redirect(
    new URL(getSafeNext(request), request.url),
    { status: 303 },
  );
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  if (existingUser) {
    console.info("Reusing Supabase development user", {
      userId: existingUser.id,
    });
    return response;
  }

  const { data, error } = await supabase.auth.signInAnonymously({
    options: {
      data: {
        access_mode: "local_development",
      },
    },
  });

  if (error) {
    console.error("Supabase development login failed", {
      code: error.code,
      message: error.message,
      status: error.status,
    });
    response = NextResponse.redirect(
      new URL("/login?error=dev_login_failed", request.url),
      { status: 303 },
    );
  } else {
    console.info("Created Supabase development user", {
      userId: data.user?.id,
    });
  }

  return response;
}
