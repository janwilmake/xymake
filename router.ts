export { XFeed } from "./do.js";

export default {
  fetch: async (request: Request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    const segments = path.split("/").filter((s) => s);

    // Extract format if present
    let format = null;
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && lastSegment.includes(".")) {
      const parts = lastSegment.split(".");
      format = parts[parts.length - 1];
      segments[segments.length - 1] = parts[0];
    }

    // Search handling
    if (segments[0] === "search" && segments.length === 1) {
      const query = url.searchParams.get("q");
      return new Response(
        `Coming Soon! Search for "${query}" ${
          format ? `in ${format} format` : ""
        }`,
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
        return new Response(
          `Coming Soon! This feature is under development.${
            format ? ` Format: ${format}` : ""
          }`,
        );
      }

      // Handle nested profile routes
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

      // Check if the route is valid
      const route = segments[1];
      if (
        validProfileRoutes.includes(route) ||
        (route === "creator-subscriptions" &&
          segments[2] === "subscriptions") ||
        (route === "status" && segments.length >= 3) ||
        (route === "reply" && segments.length >= 4) ||
        (route === "quote" && segments.length >= 4) ||
        (route === "new" && segments.length >= 3)
      ) {
        return new Response(
          `Coming Soon! This feature is under development.${
            format ? ` Format: ${format}` : ""
          }`,
        );
      }
    }

    // Handle /i/ routes
    if (segments[0] === "i") {
      const validIRoutes = ["bookmarks", "lists", "topics", "communities"];
      if (
        validIRoutes.includes(segments[1]) ||
        (segments[1] === "lists" && segments.length >= 3)
      ) {
        return new Response(
          `Coming Soon! This feature is under development.${
            format ? ` Format: ${format}` : ""
          }`,
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
        `Coming Soon! This feature is under development.${
          format ? ` Format: ${format}` : ""
        }`,
      );
    }

    // Catch-all for unhandled routes
    return new Response("Route not found", { status: 404 });
  },
};
