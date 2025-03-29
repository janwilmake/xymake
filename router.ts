import { stringify } from "yaml";
import { getFormat } from "./getFormat.js";
import { Env, xLoginMiddleware } from "./xLoginMiddleware.js";
import { postTweets } from "./postTweets.js";
import users from "./users.js";
import posts from "./posts.js";
import { profile } from "./profile.js";
import { getThread } from "./getThread.js";
import { getOgImage } from "./getOgImage.js";
export { XFeed } from "./xLoginMiddleware.js";

/** Needs to be further improved using `getFormat` */
const getDataResponse = (data: any, format: string) => {
  if (format === "application/json") {
    return new Response(JSON.stringify(data, undefined, 2), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(stringify(data), {
    headers: { "content-type": "text/yaml" },
  });
};

export default {
  fetch: async (request: Request, env: Env, ctx: any) => {
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

    // return og image directly either from cache or from regular. don't store
    const og = await getOgImage(request, env, ctx, false);
    if (og) {
      return og;
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const segments = path.split("/").filter((s) => s);
    const format = getFormat(request);
    if (!format) {
      return new Response("Bad request, invalid format expected", {
        status: 400,
      });
    }

    if (url.pathname === "/users.json" || url.pathname === "/users.md") {
      return users.fetch(request, env);
    }

    // Extract format if present
    let ext = null;
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && lastSegment.includes(".")) {
      const parts = lastSegment.split(".");
      ext = parts[parts.length - 1];
      segments[segments.length - 1] = parts[0];
    }

    // Search handling
    if (segments[0] === "search" && segments.length === 1) {
      const query = url.searchParams.get("q");
      return new Response(
        `Search is not supported (yet). Search for "${query}" ${format}`,
      );
    }

    // Username routes
    if (
      segments.length >= 1 &&
      !["i", "notifications", "messages", "home", "explore", "search"].includes(
        segments[0],
      )
    ) {
      const username = segments[0];

      const validProfileRoutes = [
        "details",
        "status",
        "photo",
        "with_replies",
        "highlights",
        "articles",
        "media",
        "likes",
        "following",
        "followers",
        "verified_followers",
        "creator-subscriptions/subscriptions",
        "lists",
        "posts",
        "reply",
        "quote",
        "new",
        "bookmarks",
      ];

      // Handle various profile routes
      if (segments.length === 1) {
        // todo: can be cleaner
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
      }

      // Check if the route is valid
      const route = segments[1];

      if (
        (route === "reply" && segments.length >= 4) ||
        (route === "quote" && segments.length >= 4) ||
        (route === "new" && segments.length >= 3)
      ) {
        return postTweets(request, env, ctx);
      }

      if (route === "status" && segments.length >= 3) {
        return getThread(request, env, ctx);
      }

      if (route === "posts" && segments.length >= 3) {
        return posts.fetch(request, env, ctx);
      }

      if (
        route === "creator-subscriptions" &&
        segments[2] === "subscriptions"
      ) {
        return new Response(
          `It's not possible yet to view your subscriptions. ${
            format ? ` Format: ${format}` : ""
          }`,
        );
      }
      if (validProfileRoutes.includes(route)) {
        return new Response(
          `It's not possible yet (${route}). ${
            format ? ` Format: ${format}` : ""
          }`,
        );
      }
    }

    // Handle /i/ routes
    if (segments[0] === "i") {
      const validIRoutes = ["bookmarks", "lists", "topics", "communities"];
      if (validIRoutes.includes(segments[1])) {
        return new Response(
          `This feature is not supported (yet). ${
            format ? ` Format: ${format}` : ""
          }`,
        );
      }

      if (segments[1] === "lists" && segments.length >= 3) {
        return new Response(
          `Viewing a specific list is coming soon.
          
          ${format ? ` Format: ${format}` : ""}`,
        );
      }
    }

    // Handle other base routes
    const validBaseRoutes = [
      "notifications",
      "messages",
      "home",
      "explore",
      "search",
    ];
    if (segments.length === 1 && validBaseRoutes.includes(segments[0])) {
      return new Response(
        `This feature is not supported (yet).${
          format ? ` Format: ${format}` : ""
        }`,
      );
    }

    // Catch-all for unhandled routes
    return new Response("Route not found", { status: 404 });
  },
};
