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

test("list returns folders and docx/html files but not other files", async () => {
  const root = await makeRoot();
  await writeFile(path.join(root, "page.htm"), "x");
  await writeFile(path.join(root, "page.html"), "x");
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/list?dir=${encodeURIComponent(root)}&token=${server.token}`);
  assert.equal(res.status, 200);
  const { entries } = await res.json();
  const names = entries.map((e) => e.name);
  assert.ok(names.includes("lesson.docx"));
  assert.ok(names.includes("page.html"));
  assert.ok(names.includes("Week 7"));
  assert.ok(!names.includes("notes.txt"));
  assert.ok(!names.includes("page.htm"));
  server.close();
});

test("list rejects directories outside the root", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const outside = path.dirname(root);
  const res = await fetch(`${server.url}/api/list?dir=${encodeURIComponent(outside)}&token=${server.token}`);
  assert.equal(res.status, 403);
  server.close();
});

test("list requires the token", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(`${server.url}/api/list?dir=${encodeURIComponent(root)}`);
  assert.equal(res.status, 403);
  server.close();
});

test("list rejects a symlink that escapes the root", async (t) => {
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
  const res = await fetch(`${server.url}/api/list?dir=${encodeURIComponent(link)}&token=${server.token}`);
  assert.equal(res.status, 403);
  server.close();
});

test("list allows a child whose name begins with dots", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, "..foo"));
  const server = await createSpecServer({ root, formHtml: "", inject: async () => {} });
  const res = await fetch(
    `${server.url}/api/list?dir=${encodeURIComponent(path.join(root, "..foo"))}&token=${server.token}`
  );
  assert.equal(res.status, 200);
  server.close();
});

test("server closes itself after the idle timeout", async () => {
  const root = await makeRoot();
  const server = await createSpecServer({
    root, formHtml: "", inject: async () => {}, idleTimeoutMs: 100,
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await assert.rejects(fetch(`${server.url}/api/config?token=${server.token}`));
  server.close();
  server.close();
});
