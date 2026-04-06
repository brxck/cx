import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { handleStatus } from "../api/status.ts";
import { handleTemplates } from "../api/templates.ts";
import { handleUp } from "../api/up.ts";
import { handleDown } from "../api/down.ts";
import { handleStop } from "../api/stop.ts";
import { handleApps } from "../api/apps.ts";
import { handleStart } from "../api/start.ts";
import { handleUpdate } from "../api/update.ts";
import { handleRestart } from "../api/restart.ts";
import { WEB_ASSETS } from "../web/embedded.ts";

export const serveCommand = defineCommand({
  meta: {
    name: "serve",
    description: "Start the mobile web UI for managing workspaces",
  },
  args: {
    port: {
      type: "string",
      alias: "p",
      description: "Port to listen on",
      default: "8080",
    },
  },
  async run({ args }) {
    const port = parseInt(args.port as string, 10);

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);
        const { pathname } = url;

        // CORS headers for development
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        if (req.method === "OPTIONS") {
          return new Response(null, { headers: corsHeaders });
        }

        // API routes
        if (pathname.startsWith("/api/")) {
          let response: Response;
          try {
            switch (pathname) {
              case "/api/status":
                response = await handleStatus();
                break;
              case "/api/templates":
                response = await handleTemplates();
                break;
              case "/api/up":
                if (req.method !== "POST") {
                  response = Response.json({ error: "Method not allowed" }, { status: 405 });
                  break;
                }
                response = await handleUp(req);
                break;
              case "/api/down":
                if (req.method !== "POST") {
                  response = Response.json({ error: "Method not allowed" }, { status: 405 });
                  break;
                }
                response = await handleDown(req);
                break;
              case "/api/apps":
                response = await handleApps(req);
                break;
              case "/api/stop":
                if (req.method !== "POST") {
                  response = Response.json({ error: "Method not allowed" }, { status: 405 });
                  break;
                }
                response = await handleStop(req);
                break;
              case "/api/start":
                if (req.method !== "POST") {
                  response = Response.json({ error: "Method not allowed" }, { status: 405 });
                  break;
                }
                response = await handleStart(req);
                break;
              case "/api/update":
                if (req.method !== "POST") {
                  response = Response.json({ error: "Method not allowed" }, { status: 405 });
                  break;
                }
                response = await handleUpdate(req);
                break;
              case "/api/restart":
                if (req.method !== "POST") {
                  response = Response.json({ error: "Method not allowed" }, { status: 405 });
                  break;
                }
                response = await handleRestart(req);
                break;
              default:
                response = Response.json({ error: "Not found" }, { status: 404 });
            }
          } catch (err: any) {
            consola.error(`API error: ${err.message}`);
            response = Response.json({ error: "Internal server error" }, { status: 500 });
          }

          // Add CORS headers to API responses
          for (const [key, value] of Object.entries(corsHeaders)) {
            response.headers.set(key, value);
          }
          return response;
        }

        // Static file serving from embedded assets
        const filePath = pathname === "/" ? "/index.html" : pathname;
        const asset = WEB_ASSETS[filePath];

        if (asset) {
          return new Response(asset.content, {
            headers: { "Content-Type": asset.contentType, ...corsHeaders },
          });
        }

        // SPA fallback — serve index.html for client-side routing
        const index = WEB_ASSETS["/index.html"];
        if (index) {
          return new Response(index.content, {
            headers: { "Content-Type": "text/html", ...corsHeaders },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    consola.log("");
    consola.log(pc.bold(`  cx serve`));
    consola.log(`  ${pc.dim("Local:")}   ${pc.cyan(`http://localhost:${server.port}`)}`);
    consola.log(`  ${pc.dim("Network:")} ${pc.cyan(`http://0.0.0.0:${server.port}`)}`);
    consola.log("");
    consola.log(pc.dim("  Press Ctrl+C to stop"));
    consola.log("");

    // Keep process alive
    await new Promise(() => {});
  },
});
