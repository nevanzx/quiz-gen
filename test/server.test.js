import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSpecServer } from "../plugin/server.js";

async function makeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "quizui-"));
  await writeFile(path.join(root, "lesson.docx"), "x");
  await writeFile(path.join(root, "notes.txt"), "x");
  await mkdir(path.join(root, "Week 7"));
  return root;
}

test("config requires the token", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "<h1>hi</h1>", inject: async () => {} });
  const res = await fetch(`${server.url}/api/config`);
  assert.equal(res.status, 403);
  server.close();
});

test("config returns the root when authed", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "<h1>hi</h1>", inject: async () => {} });
  const res = await fetch(`${server.url}/api/config?token=${server.token}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { root });
  server.close();
});

test("preview returns the formatted prompt", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/preview?token=${server.token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources: ["a.docx"], subjectCode: "FM100", description: "X" }),
  });
  assert.equal(res.status, 200);
  const { prompt } = await res.json();
  assert.match(prompt, /^Generate a quiz using the quiz-gen skill/);
  assert.match(prompt, /- Output: FM100_PRELIM\.xlsx/);
  server.close();
});

test("index serves the form and sets a cookie", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "<h1>form</h1>", inject: async () => {} });
  const res = await fetch(`${server.url}/?token=${server.token}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /form/);
  assert.match(res.headers.get("set-cookie") || "", /quizui_token=/);
  server.close();
});

test("submit rejects without token", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/submit`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 403);
  server.close();
});

test("submit injects a normalized spec on success", async () => {
  const root = await makeRoot();
  const calls = [];
  const source = path.join(root, "lesson.docx");
  const server = await createSpecServer({
    root, formHtml: "", inject: async (spec) => { calls.push(spec); },
  });
  const res = await fetch(`${server.url}/api/submit?token=${server.token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources: [source], subjectCode: "FM100", description: "X" }),
  });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].subjectCode, "FM100");
  assert.equal(calls[0].examPeriod, "PRELIM");
  assert.equal(calls[0].output, "FM100_PRELIM.xlsx");
  server.close();
});

test("submit returns 400 with field errors on invalid spec", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/submit?token=${server.token}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sources: [], subjectCode: "", description: "" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.errors.sources);
  assert.ok(body.errors.subjectCode);
  server.close();
});

test("scan finds nested sources and workbooks recursively", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "Week 7"), { recursive: true });
  await writeFile(path.join(root, "Week 7", "lesson7.html"), "x");
  await writeFile(path.join(root, "FM100_PRELIM.xlsx"), "x");
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/scan?token=${server.token}`);
  assert.equal(res.status, 200);
  const { sources, workbooks } = await res.json();
  const rels = sources.map((s) => s.rel);
  assert.ok(rels.includes("lesson.docx"));
  assert.ok(rels.includes("Week 7/lesson7.html"));
  assert.ok(!rels.some((r) => r.endsWith(".txt")));
  assert.ok(sources.every((s) => typeof s.name === "string" && typeof s.path === "string"));
  assert.ok(workbooks.some((w) => w.name === "FM100_PRELIM.xlsx"));
  server.close();
});

test("scan skips node_modules, .git and dot-directories", async () => {
  const root = await makeRoot();
  for (const dir of ["node_modules", ".git", ".cache"]) {
    await mkdir(path.join(root, dir));
    await writeFile(path.join(root, dir, "hidden.html"), "x");
  }
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const { sources } = await (await fetch(`${server.url}/api/scan?token=${server.token}`)).json();
  const rels = sources.map((s) => s.rel);
  assert.ok(!rels.some((r) => r.startsWith("node_modules/")));
  assert.ok(!rels.some((r) => r.startsWith(".git/")));
  assert.ok(!rels.some((r) => r.startsWith(".cache/")));
  server.close();
});

test("scan requires the token", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/scan`);
  assert.equal(res.status, 403);
  server.close();
});

test("scan does not follow a symlink that escapes the root", async (t) => {
  const root = await makeRoot();
  const outside = await mkdtemp(path.join(tmpdir(), "quizui-outside-"));
  await writeFile(path.join(outside, "secret.docx"), "x");
  const link = path.join(root, "escape");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("symlinks unavailable on this filesystem");
    return;
  }
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const { sources } = await (await fetch(`${server.url}/api/scan?token=${server.token}`)).json();
  assert.ok(!sources.some((s) => s.name === "secret.docx"));
  server.close();
});

test("server closes itself after the idle timeout", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({
    root, formHtml: "", inject: async () => {}, idleTimeoutMs: 100,
  });
  const live = await fetch(`${server.url}/api/config?token=${server.token}`);
  assert.equal(live.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await assert.rejects(fetch(`${server.url}/api/config?token=${server.token}`));
  assert.equal(server.closed, true);
  server.close();
  server.close();
});
