import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../src/db";
import * as schema from "../src/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  user: {
    additionalFields: {
      /**
       * `input: false` is load-bearing, not tidiness: additional fields are
       * writable at sign-up by default, so without it anyone can register with
       * `role: "admin"` and walk through every cross-vendor guard in §5.4.
       * Role changes go through an admin path, never through user input.
       */
      role: {
        type: "string",
        required: false,
        defaultValue: "customer",
        input: false,
      },
      stripeCustomerId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
});
