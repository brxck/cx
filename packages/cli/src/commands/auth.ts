import { defineCommand } from "citty";

const AUTH_URL = "https://coder.dev.ownr.dev/settings/external-auth";

export const authCommand = defineCommand({
  meta: {
    name: "auth",
    description: "Open Coder external auth settings in your browser",
  },
  run: async () => {
    await Bun.$`open ${AUTH_URL}`.quiet();
  },
});
