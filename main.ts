import { getThread } from "./getThread.js";
import { UserConfig, xLoginMiddleware } from "./xLoginMiddleware.js";
import dashboard from "./dashboard.html";
import console from "./console.html";
import { XFeed } from "./do.js";
import { makeThread } from "./makeThread.js";
import { getOgImage } from "./getOgImage.js";
import html400 from "./public/400.html";
import { identify } from "./identify.js";

export const handleConsole = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | undefined> => {
  const url = new URL(request.url);

  // Check if this is the dashboard endpoint
  if (url.pathname !== "/console") {
    return undefined;
  }

  const { isBrowser } = identify(request);
  if (!isBrowser) {
    return new Response(
      "Bad request: Dashboard is only available in browsers",
      { status: 400 },
    );
  }

  // Get access token from cookies
  const cookie = request.headers.get("Cookie") || "";
  const rows = cookie.split(";").map((x) => x.trim());
  const xAccessToken = rows
    .find((row) => row.startsWith("x_access_token="))
    ?.split("=")[1]
    ?.trim();

  const accessToken = xAccessToken ? decodeURIComponent(xAccessToken) : null;

  if (!accessToken) {
    // Redirect to login if not authenticated
    return new Response("Unauthorized", {
      status: 307,
      headers: {
        Location:
          "/login?scope=users.read%20follows.read%20tweet.read%20offline.access%20tweet.write",
      },
    });
  }

  try {
    // Check token scopes by making a request to X API
    const scopeResponse = await fetch("https://api.x.com/2/oauth2/token/info", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    let hasTweetScope = false;
    if (scopeResponse.ok) {
      try {
        const tokenInfo: any = await scopeResponse.json();
        const scopes = tokenInfo?.scopes || [];
        hasTweetScope = scopes.includes("tweet.write");
      } catch {}
    }

    // Also get username for display
    const userResponse = await fetch(
      "https://api.x.com/2/users/me?user.fields=username,profile_image_url",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (userResponse.status === 401 || userResponse.status === 403) {
      // Redirect to login if not authenticated
      return new Response("Unauthorized", {
        status: 307,
        headers: {
          Location:
            "/login?scope=users.read%20follows.read%20tweet.read%20offline.access%20tweet.write",
        },
      });
    }
    if (!userResponse.ok) {
      throw new Error(`Failed to fetch user data: ${userResponse.status}`);
    }

    const userData: any = await userResponse.json();
    const { username, profile_image_url } = userData.data;

    // Replace placeholders in the dashboard HTML
    let dashboardHtml = console
      .replaceAll("{{username}}", username)
      .replaceAll("{{profile_image_url}}", profile_image_url)
      .replaceAll("{{apiKey}}", accessToken)
      .replaceAll("{{hasTweetScope}}", hasTweetScope ? "true" : "false");

    return new Response(dashboardHtml, {
      headers: { "content-type": "text/html;charset=utf8" },
    });
  } catch (error: any) {
    return new Response(
      `Error loading dashboard: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      {
        status: 500,
      },
    );
  }
};

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

    const console = await handleConsole(request, env, ctx);
    if (console) {
      return console;
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
