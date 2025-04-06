import { stringify } from "yaml";
import { getFormat } from "./getFormat.js";
import { Env, xLoginMiddleware } from "./xLoginMiddleware.js";
import { getOgImage } from "./getOgImage.js";
export { XFeed } from "./xLoginMiddleware.js";

// Import modular endpoint handlers
import { postTweets } from "./endpoints/postTweets.js";
import users from "./endpoints/users.js";
import { getThread } from "./endpoints/getThread.js";
import { getUserProfile } from "./endpoints/getUserProfile.js";
import { getUserHighlights } from "./endpoints/getUserHighlights.js";
import { getUserLists } from "./endpoints/getUserLists.js";
import { getListDetails } from "./endpoints/getListDetails.js";
import { getArchive } from "./endpoints/getArchive.js";
import { getPostsWithReplies } from "./endpoints/getPostsWithReplies.js";

export const validProfileRoutes = [
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

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
export default {
  fetch: async (request: Request, env: Env, ctx: any) => {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
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

    if (
      url.pathname === "/users.json" ||
      url.pathname === "/users.md" ||
      url.pathname === "/users/details.json"
    ) {
      return users.fetch(request, env, ctx);
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
        `Not supported because we won't expose unauthenticated users at this stage. Format: ${format}`,
        { status: 400 },
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

      // Handle various profile routes
      if (segments.length === 1) {
        // Profile root page - show user details
        return getUserProfile(request, env, ctx);
      }

      // Check if the route is valid
      const route = segments[1];

      if (
        (route === "reply" && segments.length >= 4) ||
        (route === "quote" && segments.length >= 4) ||
        (route === "new" && segments.length >= 3)
      ) {
        return postTweets(request, env, ctx);
      } else if (route === "archive") {
        return getArchive(request, env, ctx);
      } else if (route === "status" && segments.length >= 3) {
        return getThread(request, env, ctx);
        // } else if (route === "photo") {
        //   return getUserPhoto(request, env, ctx);
      } else if (route === "with_replies") {
        const result = await getPostsWithReplies(env, ctx, username);
        const posts = result.dateResults
          .map((x) =>
            x.statusIds.map((id) => ({
              url: `https://xymake.com/${username}/status/${id}`,
              date: x.date,
            })),
          )
          .flat();
        if (format === "text/yaml") {
          return new Response(stringify(posts), {
            headers: { "content-type": "text/yaml" },
          });
        } else if (format === "application/json") {
          return new Response(JSON.stringify(posts, null, 2), {
            headers: { "content-type": "application/json" },
          });
        } else {
          return new Response(
            `Posts by @${result.username} between ${result.start} and ${
              result.end
            } (use ?start=YYYY-MM-DD&end=YYYY-MM-DD to change)
            
${result.dateResults
  .filter((x) => x.post_count > 0)
  .map(
    (item) => `# ${item.date} (${item.post_count} posts)
  
  
${item.statusIds
  .map((id) => `https://xymake.com/${item.username}/status/${id}`)
  .join("\n")}`,
  )
  .join("\n\n")}`,
            {
              headers: { "content-type": "text/markdown" },
            },
          );
        }
      } else if (route === "highlights") {
        return getUserHighlights(request, env, ctx);
      } else if (route === "lists") {
        return getUserLists(request, env, ctx);
      } else if (validProfileRoutes.includes(route)) {
        return new Response(
          `Endpoint "/${username}/${route}" is not yet implemented. Format: ${format}`,
          { status: 501 },
        );
      }
      // } else if (route === "following") {
      //   return getUserFollowing(request, env, ctx);
      // } else if (route === "followers") {
      //   return getUserFollowers(request, env, ctx);
      // } else if (route === "verified_followers") {
      //   return getUserVerifiedFollowers(request, env, ctx);
    }

    // Handle /i/ routes
    if (segments[0] === "i") {
      if (segments[1] === "lists" && segments.length >= 3) {
        // Default list details
        return getListDetails(request, env, ctx);
      }

      const validIRoutes = ["bookmarks", "lists", "topics", "communities"];
      if (validIRoutes.includes(segments[1])) {
        return new Response(
          `This feature is not supported (yet). Format: ${format}`,
          { status: 501 },
        );
      }
    }

    // Catch-all for unhandled routes
    return new Response("Route not found", { status: 404 });
  },
};
