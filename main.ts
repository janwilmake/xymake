import { getThread } from "./getThread";
import { xLoginMiddleware } from "./xLoginMiddleware";
import dashboard from "./dashboard.html";
import { XFeed } from "./do";
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

    const tweetResponse = await getThread(request, env);
    if (tweetResponse) {
      return tweetResponse;
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length === 1) {
      const username = pathParts[0].split(".")[0]; // Remove extension if present
      return new Response(dashboard.replaceAll(`{{username}}`, username), {
        headers: { "content-type": "text/html;charset=utf8" },
      });
      // Get Durable Object for this username
      // const id = env.X_FEED.idFromName(username);
      // const stub = env.X_FEED.get(id);

      // // Forward the request to the Durable Object
      // return stub.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
