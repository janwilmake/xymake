import { getThread } from "./getThread.js";
import { UserConfig, xLoginMiddleware } from "./xLoginMiddleware.js";
import dashboard from "./dashboard.html";
import { XFeed } from "./do.js";
import { makeThread } from "./makeThread.js";
import { getOgImage } from "./getOgImage.js";
import html400 from "./public/400.html";
import { identify } from "./identify.js";

export { XFeed };

interface Env {
  TWEET_KV: KVNamespace;
  SOCIALDATA_API_KEY: string;
  X_CLIENT_ID: string;
  X_CLIENT_SECRET: string;
  X_REDIRECT_URI: string;
  LOGIN_REDIRECT_URI: string;
  X_FEED: DurableObjectNamespace;
}

// Main Worker
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const xauth = await xLoginMiddleware(request, env, ctx);
    if (xauth) {
      return xauth;
    }

    const og = await getOgImage(request, env, ctx, false);
    if (og) {
      // return og image directly either from cache or from regular. don't store
      return og;
    }

    const tweetResponse = await getThread(request, env, ctx);
    if (tweetResponse) {
      return tweetResponse;
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length === 1) {
      const username = pathParts[0].split(".")[0];
      const { isBrowser } = identify(request);

      const config = await env.TWEET_KV.get<UserConfig>(
        `user:${username}`,
        "json",
      );

      if (config?.privacy !== "public") {
        if (isBrowser) {
          return new Response(
            html400.replaceAll(`{{username}}`, username || "this user"),
            { headers: { "content-type": "text/html;charset=utf8" } },
          );
        }

        return new Response(
          `Bad request: @${username} did not free their data yet. Tell them to join the free data movement, or free your own data at https://xymake.com`,
          { status: 400 },
        );
      }

      return new Response(dashboard.replaceAll(`{{username}}`, username), {
        headers: { "content-type": "text/html;charset=utf8" },
      });
    }

    const makeThreadResponse = await makeThread(request, env, ctx);
    if (makeThreadResponse) {
      return makeThreadResponse;
    }

    return new Response("Not found", { status: 404 });
  },
};
