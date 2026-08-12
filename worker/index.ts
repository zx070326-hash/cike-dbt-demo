/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  DEMO_EXPIRES_AT?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

function expiredResponse(pathname: string) {
  if (pathname.startsWith("/api/")) {
    return Response.json(
      { error: "本次内部 Demo 体验已结束。" },
      { status: 410, headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>体验已结束｜此刻</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#edf2ed;color:#17332d;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.card{width:min(460px,calc(100% - 40px));padding:40px;background:#fbfaf6;border:1px solid #d8e0da;border-radius:24px;box-shadow:0 24px 70px rgba(31,61,52,.14)}.mark{width:46px;height:46px;display:grid;place-items:center;color:#fff;background:#245d4e;border-radius:15px 15px 15px 5px;font-weight:800}h1{margin:24px 0 12px;font-family:"Songti SC",serif;font-size:32px}p{margin:0;color:#52665f;line-height:1.75}.note{margin-top:22px;padding-top:18px;border-top:1px solid #d9ded8;font-size:12px}</style><main class="card"><div class="mark">此</div><h1>本次体验已经结束</h1><p>感谢参与“此刻”DBT 心理自助技能助手的内部 Demo。体验数据不会继续开放；如需再次查看，请联系项目负责人。</p><p class="note">本工具不提供诊断、处方或个体化治疗决策。</p></main></html>`,
    {
      status: 410,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (env.DEMO_EXPIRES_AT) {
      const expiresAt = Date.parse(env.DEMO_EXPIRES_AT);
      if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
        return expiredResponse(url.pathname);
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
