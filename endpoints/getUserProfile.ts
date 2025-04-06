import { Env, UserState } from "../xLoginMiddleware.js";
import dashboard from "../dashboard.html";
import html400 from "../public/400.html";
import { getFormat } from "../getFormat.js";
import { getDataResponse } from "../getDataResponse.js";
import { corsHeaders } from "../router.js";

export const getUserProfile = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => {
  const format = getFormat(request);
  if (!format) {
    return new Response("Bad request, invalid format expected", {
      status: 400,
    });
  }

  const url = new URL(request.url);
  const segments = url.pathname.split("/").slice(1);
  const username = segments[0].split(".")[0];

  // Get user state from KV
  const userState = await env.TWEET_KV.get<UserState>(
    `user:${username}`,
    "json",
  );

  // Privacy message based on user state
  const privacyMessage =
    userState?.privacy !== "public"
      ? `@${username} did not free their data yet. Tell them to join the free data movement, or free your own data at https://xymake.com`
      : undefined;

  // If HTML format and privacy is not public, handle accordingly
  if (userState?.privacy !== "public") {
    if (format === "text/html") {
      return new Response(
        html400.replaceAll(`{{username}}`, username || "this user"),
        { headers: { "content-type": "text/html;charset=utf8" } },
      );
    }
    return new Response(privacyMessage, { status: 400 });
  }

  // If HTML format and privacy is public, return the dashboard
  if (format === "text/html" && userState?.privacy === "public") {
    return new Response(dashboard.replaceAll(`{{username}}`, username), {
      headers: { "content-type": "text/html;charset=utf8" },
    });
  }

  // For other formats, we need to fetch the profile data
  // Try to get profile from cache first
  const cacheKey = `${username}/index.json`;
  let profileData: any = await env.TWEET_KV.get(cacheKey, "json");

  // If not in cache or cache expired, fetch from Twitter API
  if (!profileData) {
    try {
      const response = await fetch(
        `https://api.socialdata.tools/twitter/user/${username}`,
        {
          headers: {
            Authorization: `Bearer ${env.SOCIALDATA_API_KEY}`,
          },
        },
      );

      if (response.ok) {
        profileData = await response.json();

        // Cache the profile data for up to a week
        ctx.waitUntil(
          env.TWEET_KV.put(cacheKey, JSON.stringify(profileData), {
            expirationTtl: 60 * 60 * 24 * 7, // 7 days
          }),
        );
      } else {
        // Handle API error
        return new Response(
          `Error fetching profile data: ${response.statusText}`,
          {
            status: response.status,
          },
        );
      }
    } catch (error: any) {
      return new Response(`Failed to fetch profile data: ${error.message}`, {
        status: 500,
      });
    }
  }

  // Prepare profile routes data
  const validProfileRoutes = ["with_replies", "highlights", "lists"];
  const routesData = validProfileRoutes.reduce((previous, current) => {
    return {
      ...previous,

      // this would be a md file for each, as a summary
      [current + ".md"]: { $ref: `${url.origin}/${username}/${current}.md` },

      // this should be a folder for each, with the actual threads and other data in there
      [current]: {
        $ref: `${url.origin}/${username}/${current}.json`,
      },
    };
  }, {} as { [key: string]: { $ref: string } });

  const posts: { [url: string]: string } | null = await env.TWEET_KV.get(
    `daily/${username}`,
    "json",
  );

  // Combine profile data with routes
  const fullData = {
    "index.json": { ...profileData, message: privacyMessage },
    "index.md": { $ref: `${url.origin}/${username}.md` },
    ...routesData,
    posts,
  };

  // Handle response based on format
  if (format === "application/json" || format === "text/yaml") {
    return getDataResponse(fullData, format);
  } else if (format === "text/markdown") {
    // Create a markdown representation of the profile
    const markdown = generateMarkdownProfile(
      profileData,
      posts,
      username,
      privacyMessage,
    );
    return new Response(markdown, {
      headers: { "content-type": "text/markdown;charset=utf8", ...corsHeaders },
    });
  } else {
    return new Response("Unsupported format", { status: 400 });
  }
};

// Helper function to generate markdown representation of a user profile
function generateMarkdownProfile(
  profileData: any,
  posts: { [url: string]: string } | null,
  username: string,
  message: string | undefined,
): string {
  if (!profileData) {
    return `# @${username}\n\n${message || "Profile data not available."}`;
  }

  let markdown = `# ${profileData.name} (@${profileData.screen_name})\n\n`;

  if (message) {
    markdown += `> ${message}\n\n`;
  }

  if (profileData.description) {
    markdown += `${profileData.description}\n\n`;
  }

  markdown += `- **Followers:** ${profileData.followers_count.toLocaleString()}\n`;
  markdown += `- **Following:** ${profileData.friends_count.toLocaleString()}\n`;
  markdown += `- **Tweets:** ${profileData.statuses_count.toLocaleString()}\n`;

  if (profileData.location) {
    markdown += `- **Location:** ${profileData.location}\n`;
  }

  if (profileData.url) {
    markdown += `- **Website:** ${profileData.url}\n`;
  }

  markdown += `- **Joined:** ${new Date(
    profileData.created_at,
  ).toLocaleDateString()}\n`;

  if (profileData.verified) {
    markdown += `- ✓ Verified account\n`;
  }

  if (posts && Object.keys(posts).length > 0) {
    markdown += "\n\n\nSOME RECENT POSTS\n\n\n";
    Object.keys(posts).forEach((key) => {
      const value = posts[key];
      markdown += `------\n${key}\n-------\n\n${value}`;
    });
  }

  return markdown;
}
