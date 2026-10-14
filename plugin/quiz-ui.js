import { tool } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { createSpecServer } from "./server.js";
import { injectSpec } from "./inject.js";
import { openBrowser } from "./browser.js";

export const QuizUiPlugin = async ({ client, directory, worktree }) => {
  const root = worktree || directory || process.cwd();
  let server = null;

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
          "quiz-gen skill is used. The user fills in the quiz spec and clicks Generate; " +
          "the spec is then typed into the OpenCode prompt and the quiz pipeline starts.",
        args: {},
        async execute() {
          if (!server) {
            const formHtml = await readFile(new URL("./ui.html", import.meta.url), "utf8");
            server = await createSpecServer({
              root,
              formHtml,
              inject: (spec) => injectSpec(client, spec),
            });
          }
          const pageUrl = `${server.url}/?token=${server.token}`;
          const opened = openBrowser(pageUrl);
          return (
            `Quiz-Gen spec UI ${opened ? "opened" : "available"} in the browser at ${pageUrl}\n` +
            "Fill in the quiz settings and click Generate — the spec will be typed into " +
            "the OpenCode prompt and the quiz pipeline will start."
          );
        },
      }),
    },
  };
};
