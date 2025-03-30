import { Env } from "../xLoginMiddleware.js";
import { getFormat } from "../getFormat.js";
import { stringify } from "yaml";

interface ListConfig {
  updatedAt: string;
  details: any;
  members: any[];
}

export async function getListDetails(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((s) => s);
  const format = getFormat(request);

  // Extract list ID from the path
  // Path format: /i/lists/{list_id}
  if (segments.length < 3) {
    return new Response(
      JSON.stringify({
        error: "Invalid list path",
        message: "Expected path format: /i/lists/{list_id}",
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const listId = segments[2]?.split(".")[0];
  // Check if we have cached list data
  const cachedList = await env.TWEET_KV.get<ListConfig>(
    `v2-list:${listId}`,
    "json",
  );

  let listDetails: any = null;
  let listMembers: any[] = [];
  const now = new Date().toISOString();

  try {
    // If we have cached data that's recent (less than 1 hour old), use it
    if (
      cachedList &&
      new Date(now).getTime() - new Date(cachedList.updatedAt).getTime() <
        3600000
    ) {
      listDetails = cachedList.details;
      listMembers = cachedList.members;
    } else {
      // Fetch fresh data from the API
      listDetails = await fetchListDetails(env, listId);
      console.log({ listDetails });
      listMembers = await fetchAllListMembers(env, listId);

      // Store in KV
      const listData: ListConfig = {
        updatedAt: now,
        details: listDetails,
        members: listMembers,
      };

      await env.TWEET_KV.put(`v2-list:${listId}`, JSON.stringify(listData));
    }

    // Build response based on the requested format
    const response = {
      details: listDetails,
      memberCount: listMembers.length,
      members: listMembers,
    };

    if (format === "text/yaml") {
      return new Response(stringify(response), {
        headers: { "content-type": "text/yaml;charset=utf8" },
      });
    } else if (format === "application/json") {
      return new Response(JSON.stringify(response, null, 2), {
        headers: { "content-type": "application/json;charset=utf8" },
      });
    } else {
      // Format markdown response
      const markdownContent = formatListAsMarkdown(listDetails, listMembers);
      return new Response(markdownContent, {
        headers: { "content-type": "text/markdown;charset=utf8" },
      });
    }
  } catch (error: any) {
    console.error(`Error fetching list details for list ${listId}:`, error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch list details",
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
 * Fetch basic details about a Twitter list
 */
async function fetchListDetails(env: Env, listId: string): Promise<any> {
  try {
    const response = await fetch(
      `https://api.socialdata.tools/twitter/lists/show?id=${listId}`,
      {
        headers: {
          Authorization: `Bearer ${env.SOCIALDATA_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `API responded with status ${
          response.status
        } - ${await response.text()}`,
      );
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching list details for list ${listId}:`, error);
    throw error;
  }
}

/**
 * Fetch all members of a Twitter list by paginating through all available pages
 */
async function fetchAllListMembers(env: Env, listId: string): Promise<any[]> {
  let allMembers: any[] = [];
  let cursor: string | null = null;
  let hasMorePages = true;

  try {
    while (hasMorePages) {
      const apiEndpoint = `https://api.socialdata.tools/twitter/lists/members?id=${listId}${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      console.log({ apiEndpoint });
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

      console.log(data);
      // If we have no users or next_cursor, we're done
      if (!data.users || data.users.length === 0) {
        hasMorePages = false;
        break;
      }

      // Add all members from this page
      allMembers = [...allMembers, ...data.users];

      // Set cursor for next page
      cursor = data.next_cursor;
      if (!cursor || cursor === "") {
        hasMorePages = false;
      }
    }

    return allMembers;
  } catch (error) {
    console.error("Error in fetchAllListMembers:", error);
    throw error;
  }
}

/**
 * Format list details and members as markdown
 */
function formatListAsMarkdown(listDetails: any, members: any[]): string {
  let markdown = "";

  // List header with details
  markdown += `# ${listDetails.name || "X List"}\n\n`;

  if (listDetails.description) {
    markdown += `${listDetails.description}\n\n`;
  }

  // List creator
  if (listDetails.user) {
    markdown += `Created by [@${listDetails.user.screen_name}](https://xymake.com/${listDetails.user.screen_name})\n\n`;
  }

  // List stats
  markdown += `**Members:** ${members.length}\n`;

  if (listDetails.subscriber_count) {
    markdown += `**Subscribers:** ${listDetails.subscriber_count}\n`;
  }

  markdown += "\n## Members\n\n";

  // Member list
  members.forEach((member) => {
    const name = member.name || "Unknown";
    const username = member.screen_name || "unknown";
    const description = member.description
      ? member.description.substring(0, 100) +
        (member.description.length > 100 ? "..." : "")
      : "";

    markdown += `- [${name} (@${username})](https://xymake.com/${username}) - ${member.followers_count.toLocaleString()} followers, ${member.friends_count.toLocaleString()} following; ${
      description ? ` - ${description.replaceAll("\n", " ")}` : ""
    } \n`;
  });

  return markdown;
}
