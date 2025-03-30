import { Env } from "../xLoginMiddleware.js";
import { getFormat } from "../getFormat.js";
import { stringify } from "yaml";

interface UserConfig {
  privacy: string;
  updatedAt?: string;
}

interface TwitterList {
  id_str: string;
  name: string;
  description: string;
  member_count: number;
  subscriber_count: number;
  mode: string;
  created_at: string;
  uri: string;
  user: {
    id_str: string;
    name: string;
    screen_name: string;
  };
}

interface ListsData {
  lists: TwitterList[];
  updatedAt: string;
}

export async function getUserLists(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((s) => s);
  const username = segments[0];
  const format = getFormat(request);

  // First, check if user is public
  const userConfig = await env.TWEET_KV.get<UserConfig>(
    `user:${username}`,
    "json",
  );

  if (userConfig?.privacy !== "public" && username !== "janwilmake") {
    return new Response(
      JSON.stringify({
        error: "This account's lists are not available",
        reason: "User profile is not public or doesn't exist",
      }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      },
    );
  }

  // Check if we have cached lists data
  const cachedLists = await env.TWEET_KV.get<ListsData>(
    `v2-lists:${username}`,
    "json",
  );

  let lists: TwitterList[] = [];
  const now = new Date().toISOString();
  let lastUpdatedAt = cachedLists?.updatedAt || null;

  // Fetch from Twitter API
  try {
    // If we have cached data, we'll use it as a base
    if (cachedLists) {
      lists = cachedLists.lists;
    }

    // Only fetch new data if:
    // 1. We have no cached data, or
    // 2. Cached data is older than 1 hour
    const shouldFetchFresh =
      !lastUpdatedAt ||
      new Date().getTime() - new Date(lastUpdatedAt).getTime() > 3600000;

    if (shouldFetchFresh) {
      // Get user profile first to get the user ID
      const userProfile = await fetchUserProfile(env, username);
      if (!userProfile || !userProfile.id_str) {
        throw new Error("User not found or ID not available");
      }

      // Fetch all lists from Twitter API
      const fetchedLists = await fetchAllLists(env, userProfile.id_str);

      if (fetchedLists.length > 0) {
        // Replace existing lists with fresh data
        lists = fetchedLists;

        // Store updated lists in KV
        const listsData: ListsData = {
          lists,
          updatedAt: now,
        };

        await env.TWEET_KV.put(
          `v2-lists:${username}`,
          JSON.stringify(listsData),
        );
      }
    }

    // Return response based on format
    if (format === "text/yaml") {
      return new Response(
        stringify({ lists, updatedAt: lastUpdatedAt || now }),
        {
          headers: { "content-type": "text/yaml;charset=utf8" },
        },
      );
    } else if (format === "application/json") {
      return new Response(
        JSON.stringify({ lists, updatedAt: lastUpdatedAt || now }, null, 2),
        {
          headers: { "content-type": "application/json;charset=utf8" },
        },
      );
    } else {
      // Format nicely for markdown
      const mdContent = formatListsAsMarkdown(username, lists);
      return new Response(mdContent, {
        headers: { "content-type": "text/markdown;charset=utf8" },
      });
    }
  } catch (error: any) {
    console.error(`Error fetching lists for ${username}:`, error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch user lists",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

/**
 * Format the lists as a nice markdown document
 */
function formatListsAsMarkdown(username: string, lists: TwitterList[]): string {
  if (lists.length === 0) {
    return `# Lists for @${username}\n\nThis user has no public lists.`;
  }

  let markdown = `# Lists for @${username}\n\n`;

  // Sort lists by member count (most members first)
  const sortedLists = [...lists].sort(
    (a, b) => b.member_count - a.member_count,
  );

  for (const list of sortedLists) {
    markdown += `## ${list.name}\n\n`;

    if (list.description) {
      markdown += `${list.description}\n\n`;
    }

    markdown += `- **Members:** ${list.member_count}\n`;
    markdown += `- **Subscribers:** ${list.subscriber_count}\n`;
    markdown += `- **Privacy:** ${
      list.mode === "Public" ? "Public" : "Private"
    }\n`;
    markdown += `- **Created:** ${new Date(
      list.created_at,
    ).toLocaleDateString()}\n`;
    markdown += `- [View List](https://xymake.com/i/lists/${list.id_str})\n\n`;
  }

  return markdown;
}

/**
 * Fetch all lists for a user by paginating through all available pages
 */
async function fetchAllLists(env: Env, userId: string): Promise<TwitterList[]> {
  let allLists: TwitterList[] = [];
  let cursor: string | null = null;
  let hasMorePages = true;

  try {
    // Continue fetching pages until we reach the end
    while (hasMorePages) {
      const apiEndpoint = buildListsApiEndpoint(env, userId, cursor);
      const response = await fetch(apiEndpoint, {
        headers: {
          Authorization: `Bearer ${env.SOCIALDATA_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data: any = await response.json();

      // If we have no lists or next_cursor, we're done
      if (!data.lists || data.lists.length === 0) {
        hasMorePages = false;
        break;
      }

      // Add all lists from this page
      allLists = [...allLists, ...data.lists];

      // Set cursor for next page
      cursor = data.next_cursor;
      if (!cursor || cursor === "") {
        hasMorePages = false;
      }
    }

    return allLists;
  } catch (error) {
    console.error("Error in fetchAllLists:", error);
    throw error;
  }
}

/**
 * Fetch user profile to get user ID
 */
async function fetchUserProfile(env: Env, username: string): Promise<any> {
  try {
    const response = await fetch(
      `https://api.socialdata.tools/twitter/user/${username}`,
      {
        headers: {
          Authorization: `Bearer ${env.SOCIALDATA_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching user profile for ${username}:`, error);
    throw error;
  }
}

/**
 * Build the API endpoint URL for lists
 */
function buildListsApiEndpoint(
  env: Env,
  userId: string,
  cursor: string | null,
): string {
  const baseUrl = `https://api.socialdata.tools/twitter/user/${userId}/lists`;

  if (cursor) {
    return `${baseUrl}?cursor=${encodeURIComponent(cursor)}`;
  }

  return baseUrl;
}
