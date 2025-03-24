import { ImageResponse } from "workers-og";
import { getThreadData } from "./getThread";
import { identify } from "./identify";

export const getOgImage = async (
  request: Request,
  env: any,
): Promise<Response | undefined> => {
  try {
    // Check if this is a crawler request or specifically requesting the OG image
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");
    if (pathParts.length < 4 || pathParts[2] !== "og") {
      return undefined;
    }

    // Extract tweet ID
    const lastPart = pathParts[3];
    const [tweetId] = lastPart.split(".");
    if (!/^\d+$/.test(tweetId)) {
      return undefined;
    }

    // Fetch thread data
    const threadData = await getThreadData(request, env);
    if (!threadData) {
      return undefined;
    }

    // Create the OG image HTML template
    const html = generateOgImageHtml(threadData);

    // Generate and return the image response
    return new ImageResponse(html, {
      width: 1200,
      height: 630,
      //   format: "png",
    });
  } catch (error: any) {
    console.error("Error generating OG image:", error);
    // Return undefined so the request can continue to regular handler
    return undefined;
  }
};

function generateOgImageHtml(threadData: {
  tweets: any[];
  userScreenNames: string[];
  participantsText: string;
  mainUser: any | null;
  totalTokens: number;
  title: string;
  description: string;
  avatarUrls: string[];
}): string {
  const { totalTokens, participantsText, mainUser, avatarUrls } = threadData;

  // Prepare subtitle: handle cases with/without main user
  let subtitle = `X Thread between ${participantsText}`;

  // Limit the number of avatars to display (max 6)
  const displayAvatars = avatarUrls.slice(0, 6);
  /* <!-- Tweet Preview -->
        <div style="background-color: #f8f8f8; border: 1px solid #e1e1e1; border-radius: 16px; padding: 24px; width: 80%; margin-top: 20px; display: flex; flex-direction: column;">
          <div style="font-size: 18px; line-height: 1.5; color: #333; overflow: hidden; text-overflow: ellipsis; max-height: 200px; display: flex;">
            ${
              threadData.tweets.length > 0
                ? threadData.tweets[0].full_text.substring(0, 280) +
                  (threadData.tweets[0].full_text.length > 280 ? "..." : "")
                : "Thread preview"
            }
          </div>
        </div>*/
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
        <div style="display: flex; align-items: center;">
          <svg width="32" height="32" viewBox="0 0 1200 1227" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z" fill="white"/>
          </svg>
          <span style="color: white; font-size: 32px; margin-left: 16px; font-weight: bold;">X Thread Context for AI</span>
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
      <div style="background-color: #000; color: white; padding: 20px 60px; font-size: 24px; text-align: center; display: flex; justify-content: center;">
        <span style="display: block;">View the full thread as text • ${
          threadData.tweets.length
        } posts</span>
      </div>
    </div>
  `;
}
