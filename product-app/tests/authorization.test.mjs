import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuthorizedProductUser } from "../lib/supabase/authorization.ts";

test("allows anonymous users only outside production", () => {
  const previousNodeEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = "development";
    assert.equal(
      isAuthorizedProductUser({ id: "dev-user", is_anonymous: true }),
      true,
    );

    process.env.NODE_ENV = "production";
    assert.equal(
      isAuthorizedProductUser({ id: "dev-user", is_anonymous: true }),
      false,
    );
    assert.equal(
      isAuthorizedProductUser({ id: "beta-user", is_anonymous: false }),
      true,
    );
    assert.equal(isAuthorizedProductUser(null), false);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});
