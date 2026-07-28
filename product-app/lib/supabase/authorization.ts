import type { User } from "@supabase/supabase-js";

export function isAuthorizedProductUser(user: User | null): user is User {
  if (!user) {
    return false;
  }

  if (process.env.NODE_ENV === "production" && user.is_anonymous) {
    return false;
  }

  return true;
}
