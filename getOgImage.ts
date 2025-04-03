import { ImageResponse } from "workers-og";
import { getThreadData, ThreadData } from "./getThreadData.js";
import { Env, UserState } from "./xLoginMiddleware.js";

export const getOgImage = async (
  request: Request,
  env: Env,
  ctx: any,
  isStore: boolean,
): Promise<Response | undefined> => {
  try {
    // Check if this is a crawler request or specifically requesting the OG image
    const url = new URL(request.url);
    // TODO: Show Alternate OG based on this from the use-cases.
    const makeId = url.searchParams.get("make");

    const pathParts = url.pathname.split("/");

    if (pathParts.length < 4 || pathParts[2] !== "og") {
      return undefined;
    }

    // Extract tweet ID
    const [, username, page, lastPart] = pathParts;
    const [tweetId, extension] = lastPart.split(".");

    if (!/^\d+$/.test(tweetId)) {
      return undefined;
    }

    // Create cache key
    const cacheKey = `og:${url.pathname}`;

    // Try to get the image from KV cache
    const cachedImage = await env.TWEET_KV.get(cacheKey, {
      type: "arrayBuffer",
    });

    if (cachedImage) {
      // If found in cache, return it with appropriate headers
      return new Response(cachedImage, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
    const userState = await env.TWEET_KV.get<UserState>(
      `user:${username}`,
      "json",
    );
    const isPublic = userState?.privacy === "public";

    // If not in cache, fetch thread data and generate the image
    const threadData = await getThreadData(request, env, ctx, isPublic);
    if (!threadData) {
      return undefined;
    }

    // Create the OG image HTML template
    const html = generateOgImageHtml(threadData);
    const config = {
      width: 1200,
      height: 630,
      format: "png",
    };

    if (!isStore) {
      // just return it
      return new ImageResponse(html, config);
    }

    // if isStore, only put in kv and
    const imageBuffer = await new ImageResponse(html, config).arrayBuffer();

    await env.TWEET_KV.put(cacheKey, imageBuffer, { expirationTtl: 86400 });

    // Return the original image response
    return new Response("Stored", { status: 202 });
  } catch (error: any) {
    console.error("Error generating OG image:", error);
    // Return undefined so the request can continue to regular handler
    return undefined;
  }
};

function generateOgImageHtml(threadData: ThreadData): string {
  const { totalTokens, participantsText, avatarUrls, userCounts } = threadData;

  // Prepare subtitle: handle cases with/without main user
  let subtitle = `X Thread ${
    Object.keys(userCounts).length === 1 ? "by" : "between"
  } ${participantsText}`;

  // Limit the number of avatars to display (max 6)
  const displayAvatars = avatarUrls.slice(0, 6);

  // Generate avatar HTML with proper positioning
  let avatarsHtml = "";
  displayAvatars.forEach((url, index) => {
    // Calculate position - position them in a row
    avatarsHtml += `
      <div style="width: 120px; height: 120px; border-radius: 50%; overflow: hidden; border: 2px solid #333; display: flex; margin-right: 10px;">
        <img src="${url}" alt="User ${index + 1}" width="120" height="120" />
      </div>
    `;
  });

  // Construct the HTML template
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; 
                background-color: #fff; margin: 0; width: 1200px; height: 630px; display: flex; flex-direction: column; position: relative;">
      <!-- Black Header Bar -->
      <div style="background-color: #000; height: 80px; width: 100%; display: flex; align-items: center; padding: 0 60px;">
        <div style="display: flex;">
         
          <span style="color: white; font-size: 32px; margin-left: 16px; font-weight: bold;">X Thread Context for AI</span>
          
          <span style="color: white; font-size: 32px; margin-left: 16px; font-weight: bold; text-align:right;">(View as text)</span>
        </div>
      </div>
      
      <!-- Main Content Area -->
      <div style="display: flex; flex-direction: column; flex: 1; padding: 60px; position: relative;">
        <!-- Token Count - Large Display -->
        <div style="font-size: 100px; font-weight: 800; margin-bottom: 16px; color: #000; display: flex;">
          ${totalTokens.toLocaleString()} tokens
        </div>
        
        <!-- Subtitle -->
        <div style="font-size: 32px; color: #333; margin-bottom: 40px; display: flex;">
          ${subtitle}
        </div>
        
       
        
        <!-- User Avatars Container - Added explicit container for avatars -->
        <div style="position: relative; height: 120px; display: flex;">
          ${avatarsHtml}
        </div>
      </div>
      
      <!-- Footer -->
      <div style="background-color: #000; color: white; padding: 20px 60px; font-size: 40px; text-align: end; display: flex; justify-content: flex-end;">
        <span style="display: block;">_</span>
      </div>
    </div>
  `;
}
