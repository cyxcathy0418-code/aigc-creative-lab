import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAuthorizedProductUser } from "@/lib/supabase/authorization";
import { handleDemoRequest } from "@/lib/passport-demo/service";
import { LocalWorkspaceStore } from "@/lib/passport-demo/local-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const store = new LocalWorkspaceStore();
async function handler(request: Request) {
  let owner: string | null = null;
  const supabase = await createServerSupabaseClient();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (isAuthorizedProductUser(user)) owner = user.id;
  }
  const url = new URL(request.url);
  if (
    !owner &&
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    const jar = await cookies();
    let session = jar.get("cp_local_demo")?.value;
    if (!session || !/^[a-f0-9-]{36}$/.test(session)) {
      session = crypto.randomUUID();
      jar.set("cp_local_demo", session, {
        httpOnly: true,
        sameSite: "strict",
        path: "/api/demo",
        maxAge: 60 * 60 * 24 * 7,
      });
    }
    owner = `local:${session}`;
  }
  return handleDemoRequest(request, owner, store);
}
export { handler as GET, handler as POST, handler as PUT };
