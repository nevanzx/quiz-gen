import http from "node:http";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { normalizeSpec, validateSpec, buildPrompt } from "./spec.js";

const MAX_BODY = 1_000_000;

function send(res, status, body, headers = {}) {
  const isHtml = typeof body === "string";
  res.writeHead(status, {
    "content-type": isHtml ? "text/html; charset=utf-8" : "application/json",
    ...headers,
  });
  res.end(isHtml ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function resolveWithinRoot(root, dir) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(dir || resolvedRoot);
  const rel = path.relative(resolvedRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

export async function createSpecServer({ root, formHtml, inject, checkFiles = true }) {
  const token = randomBytes(16).toString("hex");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const cookieAuthed = (req.headers.cookie || "")
      .split(";")
      .some((c) => c.trim() === `quizui_token=${token}`);
    const authed = url.searchParams.get("token") === token || cookieAuthed;

    try {
      if (req.method === "GET" && url.pathname === "/") {
        if (url.searchParams.get("token") !== token) return send(res, 403, { error: "forbidden" });
        return send(res, 200, formHtml, {
          "set-cookie": `quizui_token=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/config") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        return send(res, 200, { root });
      }

      if (req.method === "GET" && url.pathname === "/api/list") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        const target = resolveWithinRoot(root, url.searchParams.get("dir"));
        if (!target) return send(res, 403, { error: "forbidden" });
        let dirents;
        try {
          dirents = await readdir(target, { withFileTypes: true });
        } catch {
          return send(res, 400, { errors: { _: "Cannot read that directory." } });
        }
        const entries = dirents
          .filter((e) => e.isDirectory() || (e.isFile() && /\.(docx|html?)$/i.test(e.name)))
          .map((e) => ({
            name: e.name,
            kind: e.isDirectory() ? "dir" : "file",
            path: path.join(target, e.name),
          }))
          .sort((a, b) =>
            a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1
          );
        return send(res, 200, { entries });
      }

      if (req.method === "POST" && url.pathname === "/api/preview") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        let raw;
        try {
          raw = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { errors: { _: "Malformed request body." } });
        }
        return send(res, 200, { prompt: buildPrompt(normalizeSpec(raw)) });
      }

      if (req.method === "POST" && url.pathname === "/api/submit") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        let raw;
        try {
          raw = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { errors: { _: "Malformed request body." } });
        }
        const spec = normalizeSpec(raw);
        const { valid, errors } = validateSpec(spec, { checkFiles });
        if (!valid) return send(res, 400, { errors });
        try {
          await inject(spec);
        } catch (err) {
          return send(res, 500, { errors: { _: `Injection failed: ${err.message}` } });
        }
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { error: "not found" });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    close: () => server.close(),
  };
}
