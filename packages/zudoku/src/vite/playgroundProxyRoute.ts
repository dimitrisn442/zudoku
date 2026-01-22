import type { Application, Request, Response } from "express";

type ProxyBody = {
  method: string;
  url: string;
  headers?: Array<[string, string]>;
  body?: string;
};

function readJson(req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function setCors(req: Request, res: Response) {
  const origin = req.headers?.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

export function registerPlaygroundProxyRoute(app: Application) {
  const route = "/__zudoku/playground/proxy";

  app.options(route, (req: Request, res: Response) => {
    setCors(req, res);
    res.status(204).end();
  });

  app.post(route, async (req: Request, res: Response) => {
    try {
      setCors(req, res);

      const payload = (await readJson(req)) as unknown as ProxyBody;
      if (!payload?.url || !payload?.method) {
        res
          .status(400)
          .send("Invalid payload. Expected { method, url, headers?, body? }");
        return;
      }

      const method = String(payload.method).toUpperCase();
      const url = String(payload.url);

      let u: URL;
      try {
        u = new URL(url);
      } catch {
        res.status(400).send("Invalid URL");
        return;
      }

      if (u.protocol !== "https:") {
        res.status(400).send("Only https URLs are allowed");
        return;
      }

      const headersObj: Record<string, string> = {};
      for (const [k, v] of payload.headers ?? []) {
        if (!k) continue;
        const lower = k.toLowerCase();
        if (["host", "connection", "content-length"].includes(lower)) continue;
        headersObj[k] = v;
      }

      const upstream = await fetch(url, {
        method,
        headers: headersObj,
        body: ["GET", "HEAD"].includes(method) ? undefined : payload.body,
      });

      const text = await upstream.text();
      const outHeaders = Array.from(upstream.headers.entries());

      res
        .status(200)
        .type("application/json")
        .send(
          JSON.stringify({
            status: upstream.status,
            headers: outHeaders,
            body: text,
            size: text.length,
            contentType: upstream.headers.get("content-type") ?? "",
          }),
        );
    } catch (err) {
      res
        .status(500)
        .type("text/plain")
        .send(err?.message ?? "Proxy error");
    }
  });
}
