import { buildPrompt } from "./spec.js";

export async function injectSpec(client, spec) {
  const text = buildPrompt(spec);
  await client.tui.clearPrompt({});
  await client.tui.appendPrompt({ body: { text } });
  await client.tui.submitPrompt({});
  await client.tui.showToast({
    body: { message: "Quiz spec sent to OpenCode", variant: "success" },
  });
  return text;
}
