/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS?: Fetcher;
  DB?: D1Database;
  DEMO_EXPIRES_AT?: string;
  DATA_ENCRYPTION_KEY?: string;
  COACH_ACCESS_TOKEN?: string;
  ADMIN_ACCESS_TOKEN?: string;
  COACH_NOTIFICATION_WEBHOOK?: string;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;
  MODEL_API_KEY?: string;
  MODEL_NAME?: string;
  MODEL_BASE_URL?: string;
  MODEL_PROVIDER?: string;
  MODEL_TIMEOUT_MS?: string;
  MODEL_VERIFY_GROUNDING?: string;
  DEMO_MODEL_MODE?: string;
  RISK_MODEL_API_KEY?: string;
  RISK_MODEL_NAME?: string;
  RISK_MODEL_BASE_URL?: string;
  RISK_MODEL_TIMEOUT_MS?: string;
  NSSI_SEMANTIC_RISK_MODE?: string;
  IMAGES?: {
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

interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    // Route modules read bindings through a runtime-global bridge. Bindings are
    // deployment-scoped and immutable, so sharing the reference inside one
    // Worker isolate does not mix participant request state.
    (globalThis as typeof globalThis & { __NSSI_RUNTIME_ENV__?: Env }).__NSSI_RUNTIME_ENV__ = env ?? {};
    const url = new URL(request.url);

    if (env?.DEMO_EXPIRES_AT) {
      const expiresAt = Date.parse(env.DEMO_EXPIRES_AT);
      if (Number.isFinite(expiresAt) && Date.now() >= expiresAt) {
        return expiredResponse(url.pathname);
      }
    }

    if (url.pathname === "/_vinext/image" && env?.ASSETS && env.IMAGES) {
      const assets = env.ASSETS;
      const images = env.IMAGES;
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => assets.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env ?? {}, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env | undefined, ctx: ExecutionContext) {
    (globalThis as typeof globalThis & { __NSSI_RUNTIME_ENV__?: Env }).__NSSI_RUNTIME_ENV__ = env ?? {};
    const task = Promise.all([import("../lib/nssi/store"), import("../lib/nssi/agent")])
      .then(([{ processDueScheduledJobs, cleanupExpiredConversationData }, { personalizeScheduledNotification }]) => Promise.all([
        processDueScheduledJobs(
          new Date(controller.scheduledTime).toISOString(),
          100,
          personalizeScheduledNotification,
        ),
        cleanupExpiredConversationData(new Date(controller.scheduledTime).toISOString()),
      ]))
      .catch((error) => {
        console.error("[nssi-scheduler]", error instanceof Error ? error.message : "unknown error");
        throw error;
      });
    ctx.waitUntil(task);
  },
};

export default worker;
