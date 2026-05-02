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
import { handleActivate } from "../api/activate.ts";
import { WEB_ASSETS } from "../web/embedded.ts";
import { loadOrCreateApiKey, timingSafeEqualString, KEY_PATH } from "../lib/api-key.ts";

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
      default: "7373",
    },
    host: {
      type: "string",
      alias: "H",
      description: "Bind address (default 127.0.0.1; use 0.0.0.0 for hosted environments)",
      default: "127.0.0.1",
    },
  },
  async run({ args }) {
    const port = parseInt(args.port as string, 10);
    const hostname = (args.host as string) || "127.0.0.1";
    const apiKey = await loadOrCreateApiKey();

    function authorized(req: Request): boolean {
      const header = req.headers.get("authorization") ?? "";
      const match = header.match(/^Bearer\s+(.+)$/i);
      if (!match) return false;
      return timingSafeEqualString(match[1]!.trim(), apiKey);
    }

    function injectKey(html: string): string {
      const tag = `<meta name="cx-key" content="${apiKey}">`;
      if (html.includes('<meta name="cx-key"')) return html;
      if (html.includes("</head>")) return html.replace("</head>", `  ${tag}\n  </head>`);
      return tag + html;
    }

    const server = Bun.serve({
      port,
      hostname,
      async fetch(req) {
        const url = new URL(req.url);
        const { pathname } = url;

        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        };

        if (req.method === "OPTIONS") {
          return new Response(null, { headers: corsHeaders });
        }

        if (pathname.startsWith("/api/")) {
          if (!authorized(req)) {
            const response = Response.json({ error: "Unauthorized" }, { status: 401 });
            for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
            return response;
          }
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
              case "/api/activate":
                if (req.method !== "POST") {
                  response = Response.json({ error: "Method not allowed" }, { status: 405 });
                  break;
                }
                response = await handleActivate(req);
                break;
              default:
                response = Response.json({ error: "Not found" }, { status: 404 });
            }
          } catch (err: any) {
            consola.error(`API error: ${err.message}`);
            response = Response.json({ error: "Internal server error" }, { status: 500 });
          }

          for (const [key, value] of Object.entries(corsHeaders)) {
            response.headers.set(key, value);
          }
          return response;
        }

        const filePath = pathname === "/" ? "/index.html" : pathname;
        const asset = WEB_ASSETS[filePath];

        if (asset) {
          const isHtml = asset.contentType === "text/html";
          const body = isHtml ? injectKey(asset.content) : asset.content;
          return new Response(body, {
            headers: { "Content-Type": asset.contentType, ...corsHeaders },
          });
        }

        const index = WEB_ASSETS["/index.html"];
        if (index) {
          return new Response(injectKey(index.content), {
            headers: { "Content-Type": "text/html", ...corsHeaders },
          });
        }

        return new Response("Not Found", { status: 404 });
      },
    });

    consola.log("");
    consola.log(pc.bold(`  cx serve`));
    consola.log(`  ${pc.dim("Listen:")}  ${pc.cyan(`http://${hostname}:${server.port}`)}`);
    consola.log(`  ${pc.dim("Key:")}     ${pc.dim(KEY_PATH)}`);
    if (hostname === "0.0.0.0") {
      consola.log(`  ${pc.yellow("Warning:")} Listening on all interfaces. Authorization is required.`);
    }
    consola.log("");
    consola.log(pc.dim("  Press Ctrl+C to stop"));
    consola.log("");

    await new Promise(() => {});
  },
});
