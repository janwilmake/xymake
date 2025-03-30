import { identify } from "../identify.js";
import { Env, UserState } from "../xLoginMiddleware.js";
import dashboard from "../dashboard.html";
import html400 from "../public/400.html";
import { validProfileRoutes } from "../router.js";
import { getFormat } from "../getFormat.js";
import { getDataResponse } from "../getDataResponse.js";

export const profile = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (pathParts.length === 1) {
    const username = pathParts[0].split(".")[0];
    const { isBrowser } = identify(request);

    const config = await env.TWEET_KV.get<UserState>(
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

  return new Response("Not found", { status: 404 });
};

export const getUserProfile = async (request: Request, env: Env) => {
  const format = getFormat(request);
  if (!format) {
    return new Response("Bad request, invalid format expected", {
      status: 400,
    });
  }
  const url = new URL(request.url);
  const segments = url.pathname.split("/").slice(1);
  const username = segments[0];

  if (format === "application/json") {
    const data = validProfileRoutes.reduce((previous, current) => {
      return {
        ...previous,
        [current]: { $ref: `${url.origin}/${username}/${current}` },
      };
    }, {} as { [key: string]: { $ref: string } });
    return getDataResponse(data, format);
  }
  return profile(request, env);
};
