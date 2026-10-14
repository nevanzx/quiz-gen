import http from "node:http";
import { randomBytes } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
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

async function resolveWithinRoot(root, dir) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(dir || resolvedRoot);
  const rel = path.relative(resolvedRoot, target);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return null;
  try {
    const realRoot = await realpath(resolvedRoot);
    const realTarget = await realpath(target);
    const realRel = path.relative(realRoot, realTarget);
    if (realRel === ".." || realRel.startsWith(".." + path.sep) || path.isAbsolute(realRel)) {
      return null;
    }
  } catch {
    // target does not exist; allow it so readdir produces the 400 response
  }
  return target;
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SOURCE_RE = /\.(docx|html)$/i;
const XLSX_RE = /\.xlsx$/i;

async function scanSources(root) {
  const rootAbs = path.resolve(root);
  const sources = [];
  const workbooks = [];
  const seen = new Set();

  function addEntry(dir, name) {
    const abs = path.resolve(dir, name);
    const rel = path.relative(rootAbs, abs).split(path.sep).join("/");
    if (SOURCE_RE.test(name)) sources.push({ name, rel, path: abs });
    else if (XLSX_RE.test(name)) workbooks.push({ name, rel, path: abs });
  }

  async function walk(dir) {
    let real;
    try {
      real = await realpath(dir);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of dirents) {
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const st = await stat(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        if (!(await resolveWithinRoot(root, full))) continue;
        await walk(full);
      } else if (isFile) {
        if (!(await resolveWithinRoot(root, full))) continue;
        addEntry(dir, e.name);
      }
    }
  }

  await walk(root);
  sources.sort((a, b) => a.rel.localeCompare(b.rel));
  workbooks.sort((a, b) => a.rel.localeCompare(b.rel));
  return { sources, workbooks };
}

export async function createSpecServer({ root, formHtml, inject, checkFiles = true, idleTimeoutMs = 900000 }) {
  const token = randomBytes(16).toString("hex");

  const server = http.createServer(async (req, res) => {
    resetIdleTimer();
    let url;
    let cookieAuthed;
    let authed;

    try {
      url = new URL(req.url, "http://127.0.0.1");
      cookieAuthed = (req.headers.cookie || "")
        .split(";")
        .some((c) => c.trim() === `quizui_token=${token}`);
      authed = url.searchParams.get("token") === token || cookieAuthed;
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

      if (req.method === "GET" && url.pathname === "/api/scan") {
        if (!authed) return send(res, 403, { error: "forbidden" });
        try {
          await readdir(root);
        } catch {
          return send(res, 400, { errors: { _: "Cannot read the working directory." } });
        }
        return send(res, 200, await scanSources(root));
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

  let closed = false;
  let idleTimer = null;
  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }
  function resetIdleTimer() {
    clearIdleTimer();
    if (closed || !(idleTimeoutMs > 0)) return;
    idleTimer = setTimeout(() => {
      closeServer();
    }, idleTimeoutMs);
    if (typeof idleTimer.unref === "function") idleTimer.unref();
  }
  function closeServer() {
    if (closed) return;
    closed = true;
    clearIdleTimer();
    server.close();
  }

  resetIdleTimer();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    get closed() { return closed; },
    close: () => { closeServer(); },
  };
}
