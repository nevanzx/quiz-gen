import { tool } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { createSpecServer } from "./server.js";
import { resolveRoot } from "./spec.js";
import { injectSpec } from "./inject.js";
import { openBrowser } from "./browser.js";

export const QuizUiPlugin = async ({ client, directory, worktree }) => {
  const fallbackRoot = resolveRoot({ directory, worktree, cwd: process.cwd() });
  let currentRoot = null;
  let server = null;

  async function ensureServer(root) {
    if (server && !server.closed && currentRoot === root) return server;
    if (server && !server.closed) server.close();
    const formHtml = await readFile(new URL("./ui.html", import.meta.url), "utf8");
    server = await createSpecServer({
      root,
      formHtml,
      inject: (spec) => injectSpec(client, spec),
    });
    currentRoot = root;
    return server;
  }

  return {
    dispose: async () => {
      if (server) {
        server.close();
        server = null;
      }
    },
    tool: {
      quiz_ui: tool({
        description:
          "Open the Quiz-Gen spec UI in the browser. Call this first whenever the " +
          "quiz-gen skill is used. The UI scans the session working directory for " +
          ".docx/.html lesson sources; pass `directory` to scan a different folder. " +
          "The user fills in the quiz spec and clicks Generate; the spec is then typed " +
          "into the OpenCode prompt and the quiz pipeline starts.",
        args: {
          directory: tool.schema
            .string()
            .optional()
            .describe(
              "Absolute path of the folder to scan for .docx/.html lesson sources. " +
                "Defaults to the session working directory.",
            ),
        },
        async execute(args, context) {
          const root = resolveRoot({
            override: args?.directory,
            directory: context?.directory,
            worktree: context?.worktree,
            cwd: fallbackRoot,
          });
          try {
            await client?.app?.log?.({
              body: {
                service: "quiz-gen",
                level: "info",
                message:
                  `quiz_ui scan root: ${root} ` +
                  `(directory=${context?.directory}, worktree=${context?.worktree})`,
              },
            });
          } catch {
            // logging is best-effort
          }
          const active = await ensureServer(root);
          const pageUrl = `${active.url}/?token=${active.token}`;
          const opened = openBrowser(pageUrl);
          return (
            `Quiz-Gen spec UI ${opened ? "opened" : "available"} in the browser at ${pageUrl}\n` +
            `Scanning for lesson sources in: ${root}\n` +
            "Fill in the quiz settings and click Generate — the spec will be typed into " +
            "the OpenCode prompt and the quiz pipeline will start."
          );
        },
      }),
    },
  };
};
